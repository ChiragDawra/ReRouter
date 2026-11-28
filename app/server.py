"""ReRouter web UI.

Run from the project root:
    python app/server.py
then open http://127.0.0.1:8050
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import FIG_DIR, TRAFFIC_LEVELS, VEHICLES, WEATHERS, get_engine  # noqa: E402

STATIC = Path(__file__).resolve().parent / "static"
app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # always serve fresh UI files


class BadRequest(ValueError):
    pass


@app.errorhandler(BadRequest)
def _bad_request(err):
    return jsonify({"error": str(err)}), 400


def _body():
    return request.get_json(silent=True) or {}


def _int(body, key, default, lo, hi):
    try:
        v = int(body.get(key, default))
    except (TypeError, ValueError):
        raise BadRequest(f"'{key}' must be an integer")
    if not lo <= v <= hi:
        raise BadRequest(f"'{key}' must be between {lo} and {hi}")
    return v


def _float(body, key, default, lo, hi):
    try:
        v = float(body.get(key, default))
    except (TypeError, ValueError):
        raise BadRequest(f"'{key}' must be a number")
    if not lo <= v <= hi:
        raise BadRequest(f"'{key}' must be between {lo} and {hi}")
    return v


def _choice(body, key, default, options):
    v = body.get(key, default)
    if v not in options:
        raise BadRequest(f"'{key}' must be one of {options}")
    return v


def _trip(body):
    eng = get_engine()
    n = len(eng.zones) - 1
    overrides = body.get("overrides") or {}
    if not isinstance(overrides, dict):
        raise BadRequest("'overrides' must be an object")
    return dict(
        src=_int(body, "src", 1, 0, n), dst=_int(body, "dst", 7, 0, n),
        hour=_int(body, "hour", 12, 0, 23), weather=_choice(body, "weather", "Clear", WEATHERS),
        seed=_int(body, "seed", 1, 0, 10_000), overrides=overrides,
    )


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/figures/<path:name>")
def figure(name):
    if not name.endswith(".png"):
        abort(404)
    return send_from_directory(FIG_DIR, name)


@app.get("/api/meta")
def meta():
    return jsonify(get_engine().meta())


@app.post("/api/route")
def route():
    return jsonify(get_engine().route(**_trip(_body())))


@app.post("/api/qlearn")
def qlearn():
    body = _body()
    trip = _trip(body)
    if trip["src"] == trip["dst"]:
        raise BadRequest("Origin and destination must differ")
    episodes = _int(body, "episodes", 3000, 100, 10_000)
    return jsonify(get_engine().qlearn(**trip, episodes=episodes))


@app.post("/api/predict")
def predict():
    b = _body()
    return jsonify(get_engine().predict(
        traffic=_choice(b, "traffic", "Medium", TRAFFIC_LEVELS),
        weather=_choice(b, "weather", "Clear", WEATHERS),
        vehicle=_choice(b, "vehicle", "Car", VEHICLES),
        hour=_int(b, "hour", 9, 0, 23), day=_int(b, "day", 2, 0, 6),
        distance_km=_float(b, "distance", 15, 0.5, 500),
    ))


@app.post("/api/departure")
def departure():
    b = _body()
    return jsonify(get_engine().departure(
        desired_hour=_int(b, "hour", 9, 0, 23),
        distance_km=_float(b, "distance", 15, 0.5, 500),
        weather=_choice(b, "weather", "Rain", WEATHERS),
        window=_int(b, "window", 2, 1, 6),
    ))


if __name__ == "__main__":
    get_engine()  # load models + data once before the first request
    port = int(os.environ.get("PORT", 8050))
    print(f"ReRouter UI running at http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
