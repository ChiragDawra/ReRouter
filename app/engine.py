"""ReRouter engine: loads the CE-2 models and reproduces the notebook's routing logic.

Everything here mirrors notebooks/02_model_development.ipynb so the UI shows the
same numbers the notebook produces:
  * speed model     -> models/speed_model_poly2.joblib (traffic x weather, poly deg 2)
  * congestion clf  -> models/congestion_classifier.joblib (balanced logistic regression)
  * zone graph      -> K-Means zone centres (k=8), 4 nearest neighbours, haversine x 1.3
  * routing         -> Dijkstra on distance vs. ML-predicted travel time, plus Q-learning
  * departure tool  -> expected minutes = sum_t P(traffic=t | hour) * distance / speed(t)
"""

from __future__ import annotations

import heapq
import json
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "processed" / "traffic_route_ml_ready.csv"
MODEL_DIR = ROOT / "models"
RESULTS_PATH = ROOT / "reports" / "ce2_results.json"
FIG_DIR = ROOT / "reports" / "figures"

RANDOM_STATE = 42
PEAK_HOURS = [8, 9, 10, 17, 18, 19]
CONGESTION_THRESHOLD = 25.0
CIRCUITY = 1.3
TRAFFIC_LEVELS = ["Low", "Medium", "High"]
WEATHERS = ["Clear", "Rain", "Fog"]
VEHICLES = ["Bike", "Bus", "Car"]

NUMERIC = ["start_lat", "start_lon", "end_lat", "end_lon", "distance_km", "direct_distance_km",
           "hour", "day_of_week", "is_weekend", "is_peak_hour"]
DUMMIES = ["traffic_Medium", "traffic_High", "weather_Rain", "weather_Fog",
           "vehicle_type_Bus", "vehicle_type_Car"]
FEATURES_ALL = NUMERIC + DUMMIES
KEY_FEATURES = ["traffic_Medium", "traffic_High", "weather_Rain", "weather_Fog"]


def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return float(6371 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a)))


class Engine:
    def __init__(self):
        self.results = json.loads(RESULTS_PATH.read_text())
        self.speed_model = joblib.load(MODEL_DIR / "speed_model_poly2.joblib")
        self.clf = joblib.load(MODEL_DIR / "congestion_classifier.joblib")

        df = pd.read_csv(DATA_PATH)
        df["traffic"] = df[[f"traffic_{t}" for t in TRAFFIC_LEVELS]].idxmax(axis=1).str.replace("traffic_", "")
        self.p_traffic_hour = (pd.crosstab(df["hour"], df["traffic"], normalize="index")[TRAFFIC_LEVELS]
                               .reindex(range(24)).fillna(1 / 3))
        self.feature_means = df[NUMERIC].mean()
        self.n_rows = len(df)

        # Zones: same centres the notebook found with K-Means (k=8, random_state=42)
        self.zones = np.array(self.results["zone_centres"], dtype=float)
        coords = df[["start_lat", "start_lon"]].values
        d2 = ((coords[:, None, :] - self.zones[None, :, :]) ** 2).sum(axis=2)
        self.zone_trips = np.bincount(d2.argmin(axis=1), minlength=len(self.zones)).tolist()

        # Graph topology: each zone linked to its 4 nearest zones (undirected)
        n = len(self.zones)
        edges = set()
        for i in range(n):
            d = [haversine(*self.zones[i], *self.zones[j]) for j in range(n)]
            for j in np.argsort(d)[1:5]:
                edges.add(tuple(sorted((i, int(j)))))
        self.edges = sorted(edges)
        self.edge_km = {e: haversine(*self.zones[e[0]], *self.zones[e[1]]) * CIRCUITY for e in self.edges}
        self._speed_cache: dict[tuple[str, str], float] = {}

    # ------------------------------------------------------------------ models
    def predict_speed(self, traffic: str, weather: str) -> float:
        key = (traffic, weather)
        if key not in self._speed_cache:
            row = pd.DataFrame([[int(traffic == "Medium"), int(traffic == "High"),
                                 int(weather == "Rain"), int(weather == "Fog")]], columns=KEY_FEATURES)
            self._speed_cache[key] = float(self.speed_model.predict(row)[0])
        return self._speed_cache[key]

    def speed_breakdown(self, traffic: str, weather: str):
        """Intercept + each active term, so the prediction can be checked by hand."""
        fr = self.results["final_reg"]
        x = {"traffic_Medium": int(traffic == "Medium"), "traffic_High": int(traffic == "High"),
             "weather_Rain": int(weather == "Rain"), "weather_Fog": int(weather == "Fog")}
        terms = [{"term": "Intercept (Low traffic, Clear)", "value": fr["intercept"]}]
        for name, coef in fr["coef"].items():
            parts = name.split(" ")
            if all(x[p] for p in parts) and coef != 0:
                terms.append({"term": " × ".join(parts), "value": coef})
        return terms

    def congestion_probability(self, traffic, weather, vehicle, hour, day):
        m = self.feature_means
        row = {
            "start_lat": m["start_lat"], "start_lon": m["start_lon"],
            "end_lat": m["end_lat"], "end_lon": m["end_lon"],
            "distance_km": m["distance_km"], "direct_distance_km": m["direct_distance_km"],
            "hour": hour, "day_of_week": day, "is_weekend": int(day >= 5),
            "is_peak_hour": int(hour in PEAK_HOURS),
            "traffic_Medium": int(traffic == "Medium"), "traffic_High": int(traffic == "High"),
            "weather_Rain": int(weather == "Rain"), "weather_Fog": int(weather == "Fog"),
            "vehicle_type_Bus": int(vehicle == "Bus"), "vehicle_type_Car": int(vehicle == "Car"),
        }
        X = pd.DataFrame([row], columns=FEATURES_ALL)
        return float(self.clf.predict_proba(X)[0, 1])

    def predict(self, traffic, weather, vehicle, hour, day, distance_km):
        speed = self.predict_speed(traffic, weather)
        p = self.congestion_probability(traffic, weather, vehicle, hour, day)
        grid = [[round(self.predict_speed(t, w), 2) for w in WEATHERS] for t in TRAFFIC_LEVELS]
        return {
            "speed_kmh": speed,
            "eta_min": distance_km / speed * 60,
            "breakdown": self.speed_breakdown(traffic, weather),
            "congestion_prob": p,
            "congested": p >= 0.5,
            "below_threshold": speed < CONGESTION_THRESHOLD,
            "threshold": CONGESTION_THRESHOLD,
            "is_peak_hour": hour in PEAK_HOURS,
            "p_traffic_at_hour": self.p_traffic_hour.loc[hour].round(4).to_dict(),
            "grid": {"traffic": TRAFFIC_LEVELS, "weather": WEATHERS, "speed": grid},
        }

    # ---------------------------------------------------------------- network
    def network(self, hour: int, weather: str, seed: int, overrides: dict | None = None):
        """Traffic on each road is drawn from P(traffic | hour) observed in the data."""
        overrides = overrides or {}
        probs = self.p_traffic_hour.loc[hour].values
        rng = np.random.RandomState(seed * 100 + hour)
        graph = {i: {} for i in range(len(self.zones))}
        rows = []
        for (a, b) in self.edges:
            key = f"{a}-{b}"
            sampled = str(rng.choice(TRAFFIC_LEVELS, p=probs))
            traffic = overrides.get(key, sampled)
            if traffic not in TRAFFIC_LEVELS:
                traffic = sampled
            km = self.edge_km[(a, b)]
            speed = self.predict_speed(traffic, weather)
            minutes = km / speed * 60
            graph[a][b] = graph[b][a] = {"dist": km, "time": minutes}
            rows.append({"id": key, "a": a, "b": b, "km": km, "traffic": traffic,
                         "overridden": key in overrides, "speed": speed, "minutes": minutes})
        return graph, rows

    @staticmethod
    def dijkstra(graph, source, target, weight):
        dist = {v: np.inf for v in graph}
        prev = {}
        dist[source] = 0.0
        pq = [(0.0, source)]
        visited = []
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]:
                continue
            visited.append(u)
            if u == target:
                break
            for v, attr in graph[u].items():
                nd = d + attr[weight]
                if nd < dist[v]:
                    dist[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))
        path, node = [target], target
        while node != source:
            node = prev[node]
            path.append(node)
        return path[::-1], visited

    @staticmethod
    def path_cost(graph, path, key):
        return float(sum(graph[a][b][key] for a, b in zip(path, path[1:])))

    def route(self, src, dst, hour, weather, seed, overrides=None):
        graph, edges = self.network(hour, weather, seed, overrides)
        out = {"edges": edges}
        if src == dst:
            out["error"] = "Origin and destination are the same zone."
            return out
        p_short, _ = self.dijkstra(graph, src, dst, "dist")
        p_fast, order = self.dijkstra(graph, src, dst, "time")
        out["shortest"] = {"path": p_short, "km": self.path_cost(graph, p_short, "dist"),
                           "minutes": self.path_cost(graph, p_short, "time")}
        out["fastest"] = {"path": p_fast, "km": self.path_cost(graph, p_fast, "dist"),
                          "minutes": self.path_cost(graph, p_fast, "time"), "explored": order}
        out["same"] = p_short == p_fast
        out["saved_min"] = out["shortest"]["minutes"] - out["fastest"]["minutes"]
        out["saved_pct"] = out["saved_min"] / out["shortest"]["minutes"] * 100

        # How often does the ML-aware route beat the naive one across every OD pair?
        n = len(self.zones)
        differ, savings = 0, []
        for s in range(n):
            for t in range(s + 1, n):
                a, _ = self.dijkstra(graph, s, t, "dist")
                b, _ = self.dijkstra(graph, s, t, "time")
                if a != b:
                    differ += 1
                    sa = self.path_cost(graph, a, "time")
                    savings.append((sa - self.path_cost(graph, b, "time")) / sa * 100)
        out["network_stats"] = {"pairs": n * (n - 1) // 2, "differ": differ,
                                "avg_saving_pct": float(np.mean(savings)) if savings else 0.0}
        return out

    def qlearn(self, src, dst, hour, weather, seed, overrides=None,
               episodes=3000, alpha=0.1, gamma=1.0, epsilon=0.2, max_steps=30):
        graph, _ = self.network(hour, weather, seed, overrides)
        Q = {s: {a: 0.0 for a in graph[s]} for s in graph}
        rng = np.random.RandomState(RANDOM_STATE)
        costs = []
        for _ in range(episodes):
            s, total = src, 0.0
            for _ in range(max_steps):
                acts = list(Q[s])
                a = acts[rng.randint(len(acts))] if rng.rand() < epsilon else max(acts, key=Q[s].get)
                r = -graph[s][a]["time"]
                future = 0.0 if a == dst else max(Q[a].values())
                Q[s][a] += alpha * (r + gamma * future - Q[s][a])
                total += -r
                s = a
                if s == dst:
                    break
            costs.append(total)
        s, path = src, [src]
        while s != dst and len(path) < 20:
            s = max(Q[s], key=Q[s].get)
            path.append(s)
        reached = path[-1] == dst
        opt, _ = self.dijkstra(graph, src, dst, "time")
        roll = pd.Series(costs).rolling(50, min_periods=1).mean().values
        step = max(1, episodes // 150)
        return {
            "path": path, "reached": reached,
            "minutes": self.path_cost(graph, path, "time") if reached else None,
            "optimal_minutes": self.path_cost(graph, opt, "time"),
            "matches_dijkstra": path == opt,
            "curve": [{"episode": int(i), "minutes": float(roll[i])} for i in range(0, episodes, step)],
            "episodes": episodes,
        }

    # -------------------------------------------------------------- departure
    def expected_minutes(self, hour, distance_km, weather):
        p = self.p_traffic_hour.loc[hour]
        return float(sum(p[t] * distance_km / self.predict_speed(t, weather) * 60 for t in TRAFFIC_LEVELS))

    def departure(self, desired_hour, distance_km, weather, window=2):
        hours = [(desired_hour + dh) % 24 for dh in range(-window, window + 1)]
        base = self.expected_minutes(desired_hour, distance_km, weather)
        options = sorted(({"hour": h, "minutes": self.expected_minutes(h, distance_km, weather),
                           "delta": self.expected_minutes(h, distance_km, weather) - base} for h in hours),
                         key=lambda r: r["minutes"])
        curves = {w: [self.expected_minutes(h, distance_km, w) for h in range(24)] for w in WEATHERS}
        return {
            "desired": {"hour": desired_hour, "minutes": base},
            "best": options[0], "options": options, "window_hours": hours,
            "curves": curves,
            "p_traffic_hour": {t: self.p_traffic_hour[t].round(4).tolist() for t in TRAFFIC_LEVELS},
            "peak_hours": PEAK_HOURS,
        }

    # ------------------------------------------------------------------- meta
    def meta(self):
        r = self.results
        figures = sorted(p.name for p in FIG_DIR.glob("*.png"))
        return {
            "zones": [{"id": i, "lat": float(la), "lon": float(lo), "trips": self.zone_trips[i]}
                      for i, (la, lo) in enumerate(self.zones)],
            "edges": [{"id": f"{a}-{b}", "a": a, "b": b, "km": self.edge_km[(a, b)]} for a, b in self.edges],
            "rows": self.n_rows,
            "levels": {"traffic": TRAFFIC_LEVELS, "weather": WEATHERS, "vehicle": VEHICLES},
            "peak_hours": PEAK_HOURS,
            "threshold": CONGESTION_THRESHOLD,
            "kpis": {
                "r2": r["final_reg"]["R2"], "mae": r["final_reg"]["MAE"], "rmse": r["final_reg"]["RMSE"],
                "r2_ceiling": r.get("r2_ceiling"),
                "recall": r["final_clf"]["recall"], "f1": r["final_clf"]["f1"],
                "precision": r["final_clf"]["precision"], "accuracy": r["final_clf"]["accuracy"],
                "silhouette": r["zone_silhouette"], "clf_name": r["final_clf_name"],
                "routing": r["routing"], "qlearning_match": r["qlearning"]["matches_dijkstra"],
            },
            "final_reg": r["final_reg"],
            "final_clf_cm": {k: r["final_clf"][k] for k in ("TN", "FP", "FN", "TP")},
            "reg_table": r["reg_table"],
            "reg_cv": r.get("reg_cv"),
            "clf_table": r.get("clf_bal_table") or r.get("clf_table"),
            "top_rules": r.get("slow_rules") or r.get("top_rules"),
            "group_means": r["group_means"],
            "figures": figures,
        }


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    return Engine()
