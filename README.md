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