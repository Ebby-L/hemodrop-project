# main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from contextlib import asynccontextmanager
import json
import sqlite3
import uvicorn
from datetime import datetime
import os
import random
import time

# Environment configuration (simplified - no dotenv required)
IS_SIMULATION = os.environ.get("SIMULATION_MODE", "true").lower() == "true"
BACKEND_HOST = os.environ.get("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "8000"))

print(f"Starting in {'SIMULATION' if IS_SIMULATION else 'PRODUCTION'} mode")

# Database initialization
def init_db():
    try:
        conn = sqlite3.connect('hemodrop.db', check_same_thread=False)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS patient_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id TEXT NOT NULL,
                volume_ml REAL NOT NULL,
                rate_ml_min REAL NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_patient_timestamp 
            ON patient_data(patient_id, timestamp)
        ''')
        
        conn.commit()
        conn.close()
        print("Database initialized successfully")
    except Exception as e:
        print(f"Error initializing database: {e}")

# Lifespan event handler (replaces deprecated on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    print("=" * 50)
    print("HemoDrop Backend started successfully!")
    print(f"Mode: {'SIMULATION' if IS_SIMULATION else 'PRODUCTION'}")
    print(f"URL: http://{BACKEND_HOST}:{BACKEND_PORT}")
    print("Available endpoints:")
    print("  GET  / - API information")
    print("  GET  /health - Health check")
    print("  POST /api/data - Receive data from Pico")
    print("  WS   /ws - WebSocket for real-time updates")
    print("  GET  /api/history/{patient_id} - Get historical data")
    if IS_SIMULATION:
        print("  POST /api/simulate - Generate test data")
    print("=" * 50)
    
    yield
    
    # Shutdown (cleanup if needed)
    print("Shutting down HemoDrop Backend...")

# Initialize FastAPI app with lifespan
app = FastAPI(title="HemoDrop Backend", version="1.0.0", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class PatientData(BaseModel):
    volume_ml: float
    rate_ml_min: float
    timestamp: float
    patient_id: str

class SimulatedDataRequest(BaseModel):
    duration_minutes: int = 10
    max_volume: int = 500
    patient_id: str = "test_patient_001"

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"New WebSocket connection. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        print(f"WebSocket disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        
        for connection in disconnected:
            self.disconnect(connection)

manager = ConnectionManager()

# API endpoints
@app.get("/")
async def root():
    return {
        "message": "HemoDrop Backend API is running!",
        "version": "1.0.0",
        "mode": "simulation" if IS_SIMULATION else "production",
        "endpoints": {
            "root": "GET /",
            "health": "GET /health",
            "receive_data": "POST /api/data",
            "websocket": "WS /ws",
            "history": "GET /api/history/{patient_id}",
            "simulate": "POST /api/simulate"
        }
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "timestamp": datetime.now().isoformat(),
        "mode": "simulation" if IS_SIMULATION else "production",
        "active_connections": len(manager.active_connections)
    }

@app.post("/api/data")
async def receive_data(data: PatientData):
    try:
        print(f"Received data: {data.dict()}")
        
        # Store in database
        conn = sqlite3.connect('hemodrop.db', check_same_thread=False)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO patient_data (patient_id, volume_ml, rate_ml_min, timestamp)
            VALUES (?, ?, ?, datetime('now'))
        ''', (data.patient_id, data.volume_ml, data.rate_ml_min))
        
        conn.commit()
        conn.close()
        
        # Broadcast to WebSocket clients
        message = {
            "type": "real_time_data",
            "data": {
                "patient_id": data.patient_id,
                "volume_ml": data.volume_ml,
                "rate_ml_min": data.rate_ml_min,
                "timestamp": datetime.now().isoformat()
            }
        }
        
        await manager.broadcast(message)
        
        return {
            "status": "success",
            "message": "Data received and stored successfully",
            "received_data": data.dict()
        }
        
    except Exception as e:
        print(f"Error processing data: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "connection_established",
            "message": "Connected to HemoDrop WebSocket",
            "timestamp": datetime.now().isoformat(),
            "mode": "simulation" if IS_SIMULATION else "production"
        })
        
        while True:
            await websocket.receive_text()  # Keep connection alive
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket)

@app.get("/api/history/{patient_id}")
async def get_patient_history(patient_id: str, hours: int = 24):
    try:
        conn = sqlite3.connect('hemodrop.db', check_same_thread=False)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT volume_ml, rate_ml_min, timestamp 
            FROM patient_data 
            WHERE patient_id = ? AND timestamp > datetime('now', ?)
            ORDER BY timestamp ASC
        ''', (patient_id, f'-{hours} hours'))
        
        rows = cursor.fetchall()
        conn.close()
        
        history = []
        for row in rows:
            volume_ml, rate_ml_min, timestamp = row
            history.append({
                "volume_ml": volume_ml,
                "rate_ml_min": rate_ml_min,
                "timestamp": timestamp,
                "time": timestamp.split(' ')[1] if ' ' in timestamp else timestamp
            })
        
        return {
            "patient_id": patient_id,
            "time_range_hours": hours,
            "data_points": len(history),
            "history": history
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving history: {str(e)}")

@app.post("/api/simulate")
async def simulate_data(request: SimulatedDataRequest):
    """Generate simulated data for testing"""
    if not IS_SIMULATION:
        raise HTTPException(status_code=403, detail="Simulation mode is disabled")
    
    # Generate realistic simulation data
    base_time = time.time()
    data_points = []
    
    for i in range(request.duration_minutes):
        timestamp = base_time + (i * 60)
        # Simulate increasing blood loss with some randomness
        volume_ml = min(request.max_volume, (i * request.max_volume / request.duration_minutes) + random.uniform(-10, 10))
        rate_ml_min = random.uniform(0, 20)  # Simulate rate
        
        data = PatientData(
            volume_ml=round(max(0, volume_ml), 2),
            rate_ml_min=round(max(0, rate_ml_min), 2),
            timestamp=timestamp,
            patient_id=request.patient_id
        )
        
        # Store and broadcast
        await receive_data(data)
        data_points.append(data.dict())
        
        # Small delay to simulate real-time data
        if i < request.duration_minutes - 1:
            time.sleep(0.1)
    
    return {
        "status": "success",
        "message": f"Generated {len(data_points)} simulated data points",
        "data_points": data_points
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",  # Use import string format
        host=BACKEND_HOST,
        port=BACKEND_PORT,
        reload=True,
        log_level="info"
    )