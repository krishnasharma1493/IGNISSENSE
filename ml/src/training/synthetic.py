"""
Synthetic dataset generator — FALLBACK ONLY.

This was the original training source. It is not FIRMS or OSM data: rows are drawn
from hand-set per-class numpy distributions, and labels are a deterministic function
of the sampled features, so any metric computed on it is meaningless. It is kept so
the pipeline can still produce a loadable artifact without the real dataset
(`train.py --data-source synthetic`), and that artifact is written under a separate
name so it can never silently replace the real model.
"""

import numpy as np
import pandas as pd


def construct_dataset(num_samples: int = 10000, random_state: int = 42) -> pd.DataFrame:
    """Generate a SYNTHETIC training set from per-class numpy distributions.

    This is not FIRMS or OSM data. Labels are a deterministic function of the
    sampled features, which is why evaluation metrics come out at 1.0.
    """
    np.random.seed(random_state)
    records = []

    # Bounding box centers across India for diverse regional clusters
    clusters = [
        {'lat': 28.65, 'lon': 77.22, 'name': 'Delhi_Industrial_Corridor'},
        {'lat': 28.38, 'lon': 77.31, 'name': 'Faridabad_Manufacturing'},
        {'lat': 28.52, 'lon': 77.40, 'name': 'Noida_Works'},
        {'lat': 29.95, 'lon': 75.80, 'name': 'Punjab_Agri_Belt'},
        {'lat': 29.10, 'lon': 76.50, 'name': 'Haryana_Agri_Plain'},
        {'lat': 22.30, 'lon': 73.20, 'name': 'Gujarat_Petrochem_Refinery'},
        {'lat': 21.80, 'lon': 84.00, 'name': 'Odisha_Steel_Mining'},
        {'lat': 31.10, 'lon': 77.10, 'name': 'Himachal_Forest_Wildland'},
    ]

    class_distribution = {
        0: int(num_samples * 0.18),  # industrial_fire
        1: int(num_samples * 0.16),  # gas_flare
        2: int(num_samples * 0.14),  # wildfire
        3: int(num_samples * 0.28),  # agricultural_burning
        4: int(num_samples * 0.12),  # mining_thermal_activity
        5: int(num_samples * 0.12),  # other_or_uncertain
    }

    for label_idx, count in class_distribution.items():
        for _ in range(count):
            base_cluster = np.random.choice(clusters)
            # Add spatial jitter around base cluster
            lat = base_cluster['lat'] + np.random.normal(0, 0.15)
            lon = base_cluster['lon'] + np.random.normal(0, 0.15)

            if label_idx == 0:  # industrial_fire
                frp = float(np.random.gamma(shape=4.5, scale=7.0) + 12.0)
                brightness = float(np.random.normal(348, 16))
                brightness_ti5 = brightness - float(np.random.normal(24, 5))
                confidence = float(np.random.uniform(0.70, 0.98))
                is_night = int(np.random.choice([0, 1], p=[0.45, 0.55]))
                facility_distance_m = float(np.random.exponential(scale=220))
                facility_type_encoded = int(np.random.choice([1, 2, 3, 5, 7], p=[0.30, 0.25, 0.20, 0.15, 0.10]))
                landcover_encoded = 0  # built_up
                nearby_cluster_count_3km = int(np.random.poisson(lam=2.0) + 1)
                historical_recurrence_1_5km = int(np.random.poisson(lam=1.5))
                historical_mean_frp = float(max(2.0, frp * np.random.uniform(0.3, 0.6)))
                frp_z_score = float(np.random.uniform(1.2, 3.8))
                days_since_last_detection = float(np.random.uniform(1.0, 90.0))

            elif label_idx == 1:  # gas_flare
                frp = float(np.random.gamma(shape=3.5, scale=5.0) + 6.0)
                brightness = float(np.random.normal(355, 12))
                brightness_ti5 = brightness - float(np.random.normal(34, 6))
                confidence = float(np.random.uniform(0.85, 1.0))
                is_night = int(np.random.choice([0, 1], p=[0.20, 0.80]))
                facility_distance_m = float(np.random.exponential(scale=90))
                facility_type_encoded = int(np.random.choice([1, 2, 3], p=[0.70, 0.20, 0.10]))
                landcover_encoded = 0  # built_up
                nearby_cluster_count_3km = int(np.random.poisson(lam=1.2) + 1)
                historical_recurrence_1_5km = int(np.random.poisson(lam=12.0) + 4)
                historical_mean_frp = float(frp * np.random.uniform(0.85, 1.15))
                frp_z_score = float(np.random.uniform(0.05, 0.60))
                days_since_last_detection = float(np.random.uniform(0.2, 3.0))

            elif label_idx == 2:  # wildfire
                frp = float(np.random.gamma(shape=5.5, scale=12.0) + 25.0)
                brightness = float(np.random.normal(362, 20))
                brightness_ti5 = brightness - float(np.random.normal(28, 7))
                confidence = float(np.random.uniform(0.75, 1.0))
                is_night = int(np.random.choice([0, 1], p=[0.40, 0.60]))
                facility_distance_m = float(np.random.uniform(3000, 30000))
                facility_type_encoded = 0  # none
                landcover_encoded = 2  # forest
                nearby_cluster_count_3km = int(np.random.poisson(lam=8.0) + 3)
                historical_recurrence_1_5km = int(np.random.poisson(lam=1.0))
                historical_mean_frp = float(max(5.0, frp * np.random.uniform(0.4, 0.8)))
                frp_z_score = float(np.random.uniform(0.8, 2.8))
                days_since_last_detection = float(np.random.uniform(10.0, 365.0))

            elif label_idx == 3:  # agricultural_burning
                frp = float(np.random.gamma(shape=2.5, scale=4.0) + 2.0)
                brightness = float(np.random.normal(320, 10))
                brightness_ti5 = brightness - float(np.random.normal(12, 4))
                confidence = float(np.random.uniform(0.50, 0.90))
                is_night = int(np.random.choice([0, 1], p=[0.85, 0.15]))  # Mostly day
                facility_distance_m = float(np.random.uniform(2000, 20000))
                facility_type_encoded = 0  # none
                landcover_encoded = 1  # cropland
                nearby_cluster_count_3km = int(np.random.poisson(lam=6.0) + 2)
                historical_recurrence_1_5km = int(np.random.poisson(lam=1.8))
                historical_mean_frp = float(max(1.5, frp * np.random.uniform(0.8, 1.2)))
                frp_z_score = float(np.random.uniform(0.1, 0.9))
                days_since_last_detection = float(np.random.uniform(2.0, 180.0))

            elif label_idx == 4:  # mining_thermal_activity
                frp = float(np.random.gamma(shape=3.0, scale=5.5) + 4.0)
                brightness = float(np.random.normal(332, 14))
                brightness_ti5 = brightness - float(np.random.normal(18, 5))
                confidence = float(np.random.uniform(0.60, 0.92))
                is_night = int(np.random.choice([0, 1], p=[0.50, 0.50]))
                facility_distance_m = float(np.random.exponential(scale=600) + 80)
                facility_type_encoded = int(np.random.choice([6, 7, 4], p=[0.70, 0.20, 0.10]))
                landcover_encoded = 3  # bare/quarry
                nearby_cluster_count_3km = int(np.random.poisson(lam=3.0) + 1)
                historical_recurrence_1_5km = int(np.random.poisson(lam=5.0) + 2)
                historical_mean_frp = float(frp * np.random.uniform(0.8, 1.2))
                frp_z_score = float(np.random.uniform(0.2, 1.1))
                days_since_last_detection = float(np.random.uniform(1.0, 30.0))

            else:  # other_or_uncertain
                frp = float(np.random.gamma(shape=1.5, scale=2.5) + 0.8)
                brightness = float(np.random.normal(308, 8))
                brightness_ti5 = brightness - float(np.random.normal(7, 3))
                confidence = float(np.random.uniform(0.20, 0.55))
                is_night = int(np.random.choice([0, 1], p=[0.50, 0.50]))
                facility_distance_m = float(np.random.uniform(500, 12000))
                facility_type_encoded = int(np.random.choice([0, 7, 8], p=[0.70, 0.20, 0.10]))
                landcover_encoded = 5  # other
                nearby_cluster_count_3km = int(np.random.poisson(lam=1.0))
                historical_recurrence_1_5km = int(np.random.poisson(lam=0.6))
                historical_mean_frp = float(frp * np.random.uniform(0.7, 1.3))
                frp_z_score = float(np.random.uniform(0.0, 0.4))
                days_since_last_detection = float(np.random.uniform(5.0, 120.0))

            temp_delta = brightness - brightness_ti5

            # Grouping key for spatial block split: 0.1° grid cell (approx 11km x 11km block)
            grid_group = f"{round(lat, 1):.1f}_{round(lon, 1):.1f}"

            records.append({
                'lat': lat,
                'lon': lon,
                'grid_group': grid_group,
                'frp': max(0.2, round(frp, 2)),
                'brightness': round(brightness, 2),
                'brightness_ti5': round(brightness_ti5, 2),
                'temp_delta_ti4_ti5': round(temp_delta, 2),
                'confidence': round(confidence, 3),
                'is_night': int(is_night),
                'facility_distance_m': round(facility_distance_m, 1),
                'facility_type_encoded': int(facility_type_encoded),
                'landcover_encoded': int(landcover_encoded),
                'nearby_cluster_count_3km': int(nearby_cluster_count_3km),
                'historical_recurrence_1_5km': int(historical_recurrence_1_5km),
                'historical_mean_frp': round(historical_mean_frp, 2),
                'frp_z_score': round(frp_z_score, 2),
                'days_since_last_detection': round(days_since_last_detection, 1),
                'target': int(label_idx),
            })

    df = pd.DataFrame(records)
    return df.sample(frac=1.0, random_state=random_state).reset_index(drop=True)
