#!/usr/bin/env python3
"""
HemoDrop Detector Backend API
FastAPI backend for real-time postpartum hemorrhage monitoring
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Union
import asyncio
import json
import time
import math
from datetime import datetime, timedelta
from enum import Enum
import os
from dataclasses import dataclass
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment configuration
SIMULATION_MODE = os.getenv("SIMULATION_MODE", "true").lower() == "true"
HARDWARE_CONNECTED = os.getenv("HARDWARE_CONNECTED", "false").lower() == "true"

app = FastAPI(
    title="HemoDrop Detector API",
    description="Real-time postpartum hemorrhage monitoring system",
    version="1.0.0"
)

# CORS configuration for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data Models
class HemorrhageLevel(str, Enum):
    NORMAL = "normal"
    MINOR = "minor"
    MODERATE = "moderate" 
    MAJOR = "major"
    CRITICAL = "critical"

class AlertType(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    EMERGENCY = "emergency"

@dataclass
class HemorrhageThresholds:
    """Blood loss thresholds in mL"""
    NORMAL_MAX = 100
    MINOR_MAX = 250
    MODERATE_MAX = 500
    MAJOR_MAX = 1000

class BloodLossReading(BaseModel):
    patient_id: str
    timestamp: datetime = Field(default_factory=datetime.now)
    blood_loss_ml: float = Field(ge=0, description="Total blood loss in milliliters")
    rate_ml_per_min: float = Field(ge=0, description="Current bleeding rate in mL/min")
    device_id: str = "hemodrop_001"
    raw_weight_grams: Optional[float] = None
    temperature_celsius: Optional[float] = None
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class PatientInfo(BaseModel):
    patient_id: str
    name: str
    date_of_birth: datetime
    gravidity: int = Field(ge=0)
    parity: int = Field(ge=0)
    room_number: str
    bed_id: str
    delivery_type: str  # "vaginal", "cesarean"
    delivery_stage: str  # "active", "complete", "postpartum"
    created_at: datetime = Field(default_factory=datetime.now)

class AlertMessage(BaseModel):
    alert_id: str
    patient_id: str
    alert_type: AlertType
    message: str
    hemorrhage_level: HemorrhageLevel
    blood_loss_ml: float
    timestamp: datetime = Field(default_factory=datetime.now)
    acknowledged: bool = False

class MonitoringSession(BaseModel):
    session_id: str
    patient_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    is_active: bool = True
    total_readings: int = 0
    max_blood_loss_ml: float = 0
    max_hemorrhage_level: HemorrhageLevel = HemorrhageLevel.NORMAL

# Global state management
class MonitoringState:
    def __init__(self):
        self.active_sessions: Dict[str, MonitoringSession] = {}
        self.patients: Dict[str, PatientInfo] = {}
        self.readings_history: Dict[str, List[BloodLossReading]] = {}
        self.active_alerts: Dict[str, AlertMessage] = {}
        self.websocket_connections: List[WebSocket] = []
        
        # Initialize with sample data
        self._initialize_sample_data()
    
    def _initialize_sample_data(self):
        """Initialize with sample patient data for testing"""
        sample_patients = [
            PatientInfo(
                patient_id="patient_001",
                name="Jane Doe",
                date_of_birth=datetime(1990, 5, 15),
                gravidity=2,
                parity=1,
                room_number="101",
                bed_id="A",
                delivery_type="vaginal",
                delivery_stage="active"
            ),
            PatientInfo(
                patient_id="patient_002", 
                name="Mary Smith",
                date_of_birth=datetime(1988, 8, 22),
                gravidity=3,
                parity=2,
                room_number="102",
                bed_id="B",
                delivery_type="cesarean",
                delivery_stage="complete"
            )
        ]
        
        for patient in sample_patients:
            self.patients[patient.patient_id] = patient
            self.readings_history[patient.patient_id] = []

state = MonitoringState()

# Hemorrhage Classification Algorithm
class HemorrhageClassifier:
    def __init__(self):
        self.thresholds = HemorrhageThresholds()
    
    def classify_blood_loss(self, blood_loss_ml: float) -> HemorrhageLevel:
        """Classify hemorrhage level based on total blood loss"""
        if blood_loss_ml <= self.thresholds.NORMAL_MAX:
            return HemorrhageLevel.NORMAL
        elif blood_loss_ml <= self.thresholds.MINOR_MAX:
            return HemorrhageLevel.MINOR
        elif blood_loss_ml <= self.thresholds.MODERATE_MAX:
            return HemorrhageLevel.MODERATE
        elif blood_loss_ml <= self.thresholds.MAJOR_MAX:
            return HemorrhageLevel.MAJOR
        else:
            return HemorrhageLevel.CRITICAL
    
    def assess_bleeding_rate(self, rate_ml_per_min: float, current_level: HemorrhageLevel) -> AlertType:
        """Assess alert level based on bleeding rate and current hemorrhage level"""
        if rate_ml_per_min > 50:  # Very rapid bleeding
            return AlertType.EMERGENCY
        elif rate_ml_per_min > 20 and current_level in [HemorrhageLevel.MODERATE, HemorrhageLevel.MAJOR]:
            return AlertType.CRITICAL
        elif rate_ml_per_min > 10:
            return AlertType.WARNING
        else:
            return AlertType.INFO
    
    def should_trigger_alert(self, reading: BloodLossReading, previous_readings: List[BloodLossReading]) -> Optional[AlertMessage]:
        """Determine if an alert should be triggered based on current and historical readings"""
        current_level = self.classify_blood_loss(reading.blood_loss_ml)
        alert_type = self.assess_bleeding_rate(reading.rate_ml_per_min, current_level)
        
        # Check for rapid escalation
        if len(previous_readings) >= 3:
            recent_readings = previous_readings[-3:]
            blood_loss_trend = [r.blood_loss_ml for r in recent_readings] + [reading.blood_loss_ml]
            
            # Calculate if blood loss doubled in last 15 minutes
            if len(blood_loss_trend) >= 2:
                rate_of_increase = (blood_loss_trend[-1] - blood_loss_trend[0]) / 15  # per minute
                if rate_of_increase > 15:  # More than 15mL/min average increase
                    alert_type = AlertType.EMERGENCY
        
        # Generate alert message
        if current_level != HemorrhageLevel.NORMAL or alert_type in [AlertType.CRITICAL, AlertType.EMERGENCY]:
            messages = {
                HemorrhageLevel.NORMAL: "Normal postpartum bleeding",
                HemorrhageLevel.MINOR: "Minor hemorrhage detected - monitor closely",
                HemorrhageLevel.MODERATE: "Moderate hemorrhage - consider intervention",
                HemorrhageLevel.MAJOR: "MAJOR HEMORRHAGE - immediate intervention required",
                HemorrhageLevel.CRITICAL: "CRITICAL HEMORRHAGE - emergency response needed"
            }
            
            return AlertMessage(
                alert_id=f"alert_{reading.patient_id}_{int(time.time())}",
                patient_id=reading.patient_id,
                alert_type=alert_type,
                message=messages[current_level],
                hemorrhage_level=current_level,
                blood_loss_ml=reading.blood_loss_ml,
                timestamp=reading.timestamp
            )
        
        return None

classifier = HemorrhageClassifier()

# Hardware Interface (Simulation Mode)
class HardwareInterface:
    def __init__(self, simulation_mode: bool = True):
        self.simulation_mode = simulation_mode
        self.simulation_start_time = time.time()
        
    def get_sensor_reading(self, patient_id: str) -> Optional[BloodLossReading]:
        """Get reading from hardware sensors or simulation"""
        if self.simulation_mode:
            return self._generate_simulated_reading(patient_id)
        else:
            return self._get_hardware_reading(patient_id)
    
    def _generate_simulated_reading(self, patient_id: str) -> BloodLossReading:
        """Generate realistic simulated blood loss data"""
        elapsed_minutes = (time.time() - self.simulation_start_time) / 60
        
        # Simulate different bleeding patterns based on time
        if elapsed_minutes < 30:
            # Normal early postpartum bleeding
            base_loss = min(50, elapsed_minutes * 1.5)
            variation = math.sin(elapsed_minutes * 0.1) * 10
        elif elapsed_minutes < 60:
            # Gradual increase
            base_loss = 50 + (elapsed_minutes - 30) * 4
            variation = math.sin(elapsed_minutes * 0.15) * 15
        else:
            # Potentially concerning pattern
            base_loss = 170 + (elapsed_minutes - 60) * 8
            variation = math.sin(elapsed_minutes * 0.2) * 25
        
        total_loss = max(0, base_loss + variation + (hash(patient_id) % 20 - 10))
        
        # Calculate rate based on recent history
        recent_readings = state.readings_history.get(patient_id, [])
        if recent_readings:
            last_reading = recent_readings[-1]
            time_diff = (datetime.now() - last_reading.timestamp).total_seconds() / 60
            rate = max(0, (total_loss - last_reading.blood_loss_ml) / max(time_diff, 1))
        else:
            rate = total_loss / max(elapsed_minutes, 1)
        
        return BloodLossReading(
            patient_id=patient_id,
            blood_loss_ml=round(total_loss, 1),
            rate_ml_per_min=round(rate, 2),
            raw_weight_grams=round(total_loss * 1.05, 1),  # Blood density ~1.05 g/mL
            temperature_celsius=37.0 + (hash(patient_id) % 10 - 5) * 0.1
        )
    
    def _get_hardware_reading(self, patient_id: str) -> Optional[BloodLossReading]:
        """Get actual reading from Raspberry Pi hardware"""
        try:
            # This would interface with your actual hardware
            # Example implementation for MicroPython/Raspberry Pi integration
            
            # Read from load cell via HX711
            raw_weight = self._read_load_cell()
            
            # Convert weight to volume (accounting for pad weight, blood density)
            pad_weight = 50  # grams, adjust for your pads
            blood_weight = max(0, raw_weight - pad_weight)
            blood_volume = blood_weight / 1.05  # blood density
            
            # Read from other sensors if available
            temperature = self._read_temperature_sensor()
            
            # Calculate rate from previous readings
            recent_readings = state.readings_history.get(patient_id, [])
            rate = self._calculate_bleeding_rate(blood_volume, recent_readings)
            
            return BloodLossReading(
                patient_id=patient_id,
                blood_loss_ml=blood_volume,
                rate_ml_per_min=rate,
                raw_weight_grams=raw_weight,
                temperature_celsius=temperature
            )
            
        except Exception as e:
            logger.error(f"Hardware reading error: {e}")
            return None
    
    def _read_load_cell(self) -> float:
        """Read from HX711 load cell amplifier"""
        # Placeholder for actual hardware integration
        # import hx711  # Your hardware library
        # return hx711.read_weight()
        return 0.0
    
    def _read_temperature_sensor(self) -> float:
        """Read temperature from sensor"""
        # Placeholder for actual hardware integration
        return 37.0
    
    def _calculate_bleeding_rate(self, current_volume: float, recent_readings: List[BloodLossReading]) -> float:
        """Calculate current bleeding rate from recent readings"""
        if not recent_readings:
            return 0.0
        
        # Use last 5 minutes of readings for rate calculation
        now = datetime.now()
        recent = [r for r in recent_readings if (now - r.timestamp).total_seconds() <= 300]
        
        if len(recent) < 2:
            return 0.0
        
        # Linear regression for more accurate rate calculation
        times = [(now - r.timestamp).total_seconds() / 60 for r in recent]
        volumes = [r.blood_loss_ml for r in recent]
        
        n = len(recent)
        sum_x = sum(times)
        sum_y = sum(volumes)
        sum_xy = sum(t * v for t, v in zip(times, volumes))
        sum_x2 = sum(t * t for t in times)
        
        if n * sum_x2 - sum_x * sum_x == 0:
            return 0.0
        
        slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
        return max(0, -slope)  # Negative because time goes backward

hardware = HardwareInterface(simulation_mode=SIMULATION_MODE)

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        try:
            await websocket.send_text(message)
        except:
            self.disconnect(websocket)
    
    async def broadcast(self, message: str):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                disconnected.append(connection)
        
        # Clean up disconnected websockets
        for connection in disconnected:
            self.disconnect(connection)

manager = ConnectionManager()

# API Endpoints

@app.get("/")
async def root():
    return {
        "message": "HemoDrop Detector API",
        "version": "1.0.0",
        "simulation_mode": SIMULATION_MODE,
        "hardware_connected": HARDWARE_CONNECTED
    }

@app.get("/patients", response_model=List[PatientInfo])
async def get_patients():
    """Get all registered patients"""
    return list(state.patients.values())

@app.post("/patients", response_model=PatientInfo)
async def create_patient(patient: PatientInfo):
    """Register a new patient"""
    if patient.patient_id in state.patients:
        raise HTTPException(status_code=400, detail="Patient already exists")
    
    state.patients[patient.patient_id] = patient
    state.readings_history[patient.patient_id] = []
    
    logger.info(f"New patient registered: {patient.name} ({patient.patient_id})")
    return patient

@app.get("/patients/{patient_id}", response_model=PatientInfo)
async def get_patient(patient_id: str):
    """Get specific patient information"""
    if patient_id not in state.patients:
        raise HTTPException(status_code=404, detail="Patient not found")
    return state.patients[patient_id]

@app.get("/patients/{patient_id}/readings", response_model=List[BloodLossReading])
async def get_patient_readings(patient_id: str, limit: int = 100):
    """Get blood loss readings for a specific patient"""
    if patient_id not in state.patients:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    readings = state.readings_history.get(patient_id, [])
    return readings[-limit:] if limit > 0 else readings

@app.post("/patients/{patient_id}/readings", response_model=BloodLossReading)
async def add_reading(patient_id: str, reading: BloodLossReading):
    """Add a new blood loss reading (manual entry)"""
    if patient_id not in state.patients:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    reading.patient_id = patient_id
    reading.timestamp = datetime.now()
    
    # Store reading
    if patient_id not in state.readings_history:
        state.readings_history[patient_id] = []
    
    state.readings_history[patient_id].append(reading)
    
    # Check for alerts
    previous_readings = state.readings_history[patient_id][:-1]
    alert = classifier.should_trigger_alert(reading, previous_readings)
    
    if alert:
        state.active_alerts[alert.alert_id] = alert
        # Broadcast alert via WebSocket
        await manager.broadcast(json.dumps({
            "type": "alert",
            "data": alert.dict()
        }))
    
    # Broadcast reading via WebSocket
    await manager.broadcast(json.dumps({
        "type": "reading",
        "data": reading.dict()
    }))
    
    logger.info(f"New reading for {patient_id}: {reading.blood_loss_ml}mL")
    return reading

@app.get("/patients/{patient_id}/current-status")
async def get_current_status(patient_id: str):
    """Get current hemorrhage status for a patient"""
    if patient_id not in state.patients:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    readings = state.readings_history.get(patient_id, [])
    if not readings:
        return {
            "patient_id": patient_id,
            "current_blood_loss_ml": 0,
            "hemorrhage_level": HemorrhageLevel.NORMAL,
            "bleeding_rate_ml_per_min": 0,
            "last_reading_time": None,
            "active_alerts": []
        }
    
    latest_reading = readings[-1]
    current_level = classifier.classify_blood_loss(latest_reading.blood_loss_ml)
    
    # Get active alerts for this patient
    patient_alerts = [
        alert for alert in state.active_alerts.values()
        if alert.patient_id == patient_id and not alert.acknowledged
    ]
    
    return {
        "patient_id": patient_id,
        "current_blood_loss_ml": latest_reading.blood_loss_ml,
        "hemorrhage_level": current_level,
        "bleeding_rate_ml_per_min": latest_reading.rate_ml_per_min,
        "last_reading_time": latest_reading.timestamp,
        "active_alerts": patient_alerts
    }

@app.post("/monitoring/start/{patient_id}")
async def start_monitoring(patient_id: str):
    """Start continuous monitoring for a patient"""
    if patient_id not in state.patients:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    session_id = f"session_{patient_id}_{int(time.time())}"
    session = MonitoringSession(
        session_id=session_id,
        patient_id=patient_id,
        start_time=datetime.now()
    )
    
    state.active_sessions[session_id] = session
    
    logger.info(f"Started monitoring session for {patient_id}: {session_id}")
    return {"session_id": session_id, "status": "monitoring_started"}

@app.post("/monitoring/stop/{session_id}")
async def stop_monitoring(session_id: str):
    """Stop monitoring session"""
    if session_id not in state.active_sessions:
        raise HTTPException(status_code=404, detail="Monitoring session not found")
    
    session = state.active_sessions[session_id]
    session.end_time = datetime.now()
    session.is_active = False
    
    logger.info(f"Stopped monitoring session: {session_id}")
    return {"session_id": session_id, "status": "monitoring_stopped"}

@app.get("/alerts", response_model=List[AlertMessage])
async def get_alerts(active_only: bool = True):
    """Get system alerts"""
    alerts = list(state.active_alerts.values())
    if active_only:
        alerts = [alert for alert in alerts if not alert.acknowledged]
    return alerts

@app.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    """Acknowledge an alert"""
    if alert_id not in state.active_alerts:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    state.active_alerts[alert_id].acknowledged = True
    
    await manager.broadcast(json.dumps({
        "type": "alert_acknowledged",
        "data": {"alert_id": alert_id}
    }))
    
    return {"status": "acknowledged", "alert_id": alert_id}

# WebSocket endpoint for real-time updates
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive and handle incoming messages
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif message.get("type") == "subscribe_patient":
                patient_id = message.get("patient_id")
                # Handle patient-specific subscription logic here
                await websocket.send_text(json.dumps({
                    "type": "subscribed",
                    "patient_id": patient_id
                }))
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Background task for continuous monitoring
@app.on_event("startup")
async def startup_event():
    """Start background monitoring tasks"""
    asyncio.create_task(continuous_monitoring_task())

async def continuous_monitoring_task():
    """Background task to continuously collect sensor data"""
    logger.info("Started continuous monitoring task")
    
    while True:
        try:
            # Process all active monitoring sessions
            for session_id, session in state.active_sessions.items():
                if not session.is_active:
                    continue
                
                patient_id = session.patient_id
                
                # Get sensor reading
                reading = hardware.get_sensor_reading(patient_id)
                
                if reading:
                    # Store reading
                    if patient_id not in state.readings_history:
                        state.readings_history[patient_id] = []
                    
                    state.readings_history[patient_id].append(reading)
                    session.total_readings += 1
                    session.max_blood_loss_ml = max(session.max_blood_loss_ml, reading.blood_loss_ml)
                    
                    # Update hemorrhage level
                    current_level = classifier.classify_blood_loss(reading.blood_loss_ml)
                    if current_level.value > session.max_hemorrhage_level.value:
                        session.max_hemorrhage_level = current_level
                    
                    # Check for alerts
                    previous_readings = state.readings_history[patient_id][:-1]
                    alert = classifier.should_trigger_alert(reading, previous_readings)
                    
                    if alert:
                        state.active_alerts[alert.alert_id] = alert
                        # Broadcast alert
                        await manager.broadcast(json.dumps({
                            "type": "alert",
                            "data": alert.dict()
                        }))
                        logger.warning(f"Alert triggered for {patient_id}: {alert.message}")
                    
                    # Broadcast reading
                    await manager.broadcast(json.dumps({
                        "type": "reading",
                        "data": reading.dict()
                    }))
                    
                    # Clean up old readings (keep last 24 hours)
                    cutoff_time = datetime.now() - timedelta(hours=24)
                    state.readings_history[patient_id] = [
                        r for r in state.readings_history[patient_id]
                        if r.timestamp > cutoff_time
                    ]
            
            # Wait before next reading cycle
            await asyncio.sleep(30)  # Read every 30 seconds
            
        except Exception as e:
            logger.error(f"Error in continuous monitoring: {e}")
            await asyncio.sleep(5)  # Short delay before retry

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True,
        log_level="info"
    )