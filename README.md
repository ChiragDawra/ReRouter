# ReRouter 🚦

### Traffic Route Optimization System

ReRouter is an AI/ML-based traffic route optimization project designed to identify efficient routes by considering traffic, environmental, geographical, and temporal conditions.

Unlike a route-selection approach based only on distance, ReRouter aims to incorporate factors such as traffic conditions, weather, vehicle type, travel time patterns, and geographical information to estimate travel conditions and support intelligent route selection.

---

## 📌 Project Overview

In real-world transportation systems, the shortest route is not always the fastest route.

Traffic congestion, weather conditions, vehicle characteristics, time of day, and geographical factors can influence vehicle speed and consequently affect travel time.

ReRouter is being developed as a machine learning-based system that will learn traffic and mobility patterns from historical trip data.

The planned system will use these predictions to estimate travel costs and support route optimization between a source and destination.

---

## 🎯 Project Objectives

The main objectives of ReRouter are:

1. Analyse historical traffic and mobility data.
2. Clean and preprocess the dataset for machine learning.
3. Identify important traffic, geographical, environmental, and temporal features.
4. Engineer meaningful features from existing trip data.
5. Develop a machine learning model for predicting vehicle speed.
6. Estimate travel time using predicted speed and route distance.
7. Integrate the prediction component with a route optimization algorithm.
8. Identify an efficient route between a source and destination.

---

## 🧠 Planned System Architecture

The planned workflow of ReRouter is:

```text
Historical Traffic Data
        │
        ▼
Data Cleaning & Preprocessing
        │
        ▼
Feature Engineering
        │
        ▼
Machine Learning Model
        │
        ▼
Predicted Vehicle Speed
        │
        ▼
Estimated Travel Time
        │
        ▼
Route Cost
        │
        ▼
Route Optimization
        │
        ▼
Efficient Route
```

---

## 📊 CE-2: Model Development & Route Optimization

`notebooks/02_model_development.ipynb` builds the ML engine and plugs it into a route optimizer:

| Component | Method | Result |
|---|---|---|
| Speed prediction | Polynomial regression (degree 2, traffic × weather) | Test R² 0.600 (= data ceiling), MAE 7.2 km/h |
| Congestion warning | Logistic Regression (balanced), compared with KNN, Decision Tree, Random Forest, Naive Bayes, SVM | Recall 0.90, F1 0.68 |
| Zones for the road graph | K-Means (k = 8), compared with Hierarchical and DBSCAN | Silhouette 0.36 |
| Condition patterns | Apriori / FP-Growth | {High traffic, Fog} → {Slow}: confidence 0.96, lift 3.8 |
| Routing | Dijkstra on ML-predicted travel times + Q-learning agent | Fastest route up to 45% quicker than shortest; Q-learning matches Dijkstra |
| Recommendation | Best departure time from P(traffic \| hour) | e.g. 11 AM instead of 9 AM saves ~11 min on 15 km in rain |

Outputs: `reports/figures/` (18 figures), `reports/ce2_results.json`, `models/*.joblib`, and the companion guide `reports/ReRouter_CE2_Companion_Guide.pdf`.

**Run it:** `pip install -r requirements.txt`, then open the notebook and *Run All* (about 1 minute on a laptop CPU; no GPU needed). On Google Colab, open the notebook from GitHub and *Run All* — it installs `mlxtend` and clones the repo automatically.

---

## 🖥️ Web UI

An interactive dashboard that runs the trained CE-2 models live:

```bash
pip install -r requirements.txt
python app/server.py          # then open http://127.0.0.1:8050
```

| Tab | What it does |
|---|---|
| **Route Planner** | Map of the 8 K-Means zones and their roads. Pick origin/destination, weather and hour; road traffic is sampled from P(traffic \| hour) in the data. Compares the **shortest** route (distance) with the **fastest** route (Dijkstra on ML-predicted travel time). Click any road to change its traffic. Train the **Q-learning** agent on the same network and check it matches Dijkstra. |
| **Speed Lab** | Predicted speed and congestion probability for any traffic/weather/vehicle/time. Shows the regression terms that add up to the prediction, so it can be checked by hand. |
| **Departure** | Best departure time within a flexible window, with expected travel time for every hour of the day. |
| **Model Insights** | Final metrics, regression and classifier comparisons, confusion matrix, association rules and all 18 notebook figures. |

`app/engine.py` reuses the saved models (`models/*.joblib`) and mirrors the notebook's routing code, so the UI shows the same numbers as the notebook (for example the Z1 → Z7 route saves 45 %). Leaflet and Chart.js are bundled in `app/static/vendor/`, so the app works offline. Only the background map tiles need internet.
