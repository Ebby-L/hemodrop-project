// api.js - Frontend API integration and data management

// API Configuration
const API_CONFIG = {
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000',
    wsURL: process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws',
    timeout: 10000,
  };
  
  // Data Types (TypeScript-like interfaces for documentation)
  /**
   * @typedef {Object} PatientInfo
   * @property {string} patient_id
   * @property {string} name
   * @property {string} date_of_birth
   * @property {number} gravidity
   * @property {number} parity
   * @property {string} room_number
   * @property {string} bed_id
   * @property {string} delivery_type - "vaginal" | "cesarean"
   * @property {string} delivery_stage - "active" | "complete" | "postpartum"
   * @property {string} created_at
   */
  
  /**
   * @typedef {Object} BloodLossReading
   * @property {string} patient_id
   * @property {string} timestamp
   * @property {number} blood_loss_ml
   * @property {number} rate_ml_per_min
   * @property {string} device_id
   * @property {number} raw_weight_grams
   * @property {number} temperature_celsius
   */
  
  /**
   * @typedef {Object} AlertMessage
   * @property {string} alert_id
   * @property {string} patient_id
   * @property {string} alert_type - "info" | "warning" | "critical" | "emergency"
   * @property {string} message
   * @property {string} hemorrhage_level - "normal" | "minor" | "moderate" | "major" | "critical"
   * @property {number} blood_loss_ml
   * @property {string} timestamp
   * @property {boolean} acknowledged
   */
  
  // API Class for all backend communication
  class HemoDropAPI {
    constructor() {
      this.baseURL = API_CONFIG.baseURL;
      this.wsURL = API_CONFIG.wsURL;
      this.ws = null;
      this.wsReconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.eventListeners = {
        reading: [],
        alert: [],
        connection: [],
        error: []
      };
    }
  
    // HTTP API Methods
    async request(endpoint, options = {}) {
      const url = `${this.baseURL}${endpoint}`;
      const config = {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      };
  
      try {
        const response = await fetch(url, config);
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({ 
            detail: `HTTP ${response.status}: ${response.statusText}` 
          }));
          throw new Error(error.detail || 'API request failed');
        }
  
        return await response.json();
      } catch (error) {
        console.error(`API request failed for ${endpoint}:`, error);
        throw error;
      }
    }
  
    // Patient Management
    async getPatients() {
      return this.request('/patients');
    }
  
    async getPatient(patientId) {
      return this.request(`/patients/${patientId}`);
    }
  
    async createPatient(patientData) {
      return this.request('/patients', {
        method: 'POST',
        body: JSON.stringify(patientData),
      });
    }
  
    // Blood Loss Readings
    async getPatientReadings(patientId, limit = 100) {
      return this.request(`/patients/${patientId}/readings?limit=${limit}`);
    }
  
    async addReading(patientId, readingData) {
      return this.request(`/patients/${patientId}/readings`, {
        method: 'POST',
        body: JSON.stringify(readingData),
      });
    }
  
    async getCurrentStatus(patientId) {
      return this.request(`/patients/${patientId}/current-status`);
    }
  
    // Monitoring Sessions
    async startMonitoring(patientId) {
      return this.request(`/monitoring/start/${patientId}`, {
        method: 'POST',
      });
    }
  
    async stopMonitoring(sessionId) {
      return this.request(`/monitoring/stop/${sessionId}`, {
        method: 'POST',
      });
    }
  
    // Alerts
    async getAlerts(activeOnly = true) {
      return this.request(`/alerts?active_only=${activeOnly}`);
    }
  
    async acknowledgeAlert(alertId) {
      return this.request(`/alerts/${alertId}/acknowledge`, {
        method: 'POST',
      });
    }
  
    // WebSocket Connection Management
    connectWebSocket() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return; // Already connected
      }
  
      try {
        this.ws = new WebSocket(this.wsURL);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.wsReconnectAttempts = 0;
          this.notifyListeners('connection', { status: 'connected' });
          
          // Send ping periodically to keep connection alive
          setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 30000);
        };
  
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };
  
        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.notifyListeners('connection', { status: 'disconnected' });
          this.attemptReconnect();
        };
  
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.notifyListeners('error', { error: 'WebSocket connection error' });
        };
  
      } catch (error) {
        console.error('Failed to establish WebSocket connection:', error);
        this.notifyListeners('error', { error: 'Failed to connect to real-time updates' });
      }
    }
  
    disconnectWebSocket() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }
  
    attemptReconnect() {
      if (this.wsReconnectAttempts < this.maxReconnectAttempts) {
        this.wsReconnectAttempts++;
        console.log(`Attempting WebSocket reconnect ${this.wsReconnectAttempts}/${this.maxReconnectAttempts}`);
        
        setTimeout(() => {
          this.connectWebSocket();
        }, 2000 * this.wsReconnectAttempts); // Exponential backoff
      } else {
        console.error('Max WebSocket reconnection attempts reached');
        this.notifyListeners('error', { error: 'Lost connection to real-time updates' });
      }
    }
  
    handleWebSocketMessage(data) {
      switch (data.type) {
        case 'reading':
          this.notifyListeners('reading', data.data);
          break;
        case 'alert':
          this.notifyListeners('alert', data.data);
          break;
        case 'alert_acknowledged':
          this.notifyListeners('alert', { ...data.data, acknowledged: true });
          break;
        case 'pong':
          // Heartbeat response - connection is alive
          break;
        default:
          console.log('Unknown WebSocket message type:', data.type);
      }
    }
  
    subscribeToPatient(patientId) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'subscribe_patient',
          patient_id: patientId
        }));
      }
    }
  
    // Event Listener Management
    addEventListener(eventType, callback) {
      if (this.eventListeners[eventType]) {
        this.eventListeners[eventType].push(callback);
      }
    }
  
    removeEventListener(eventType, callback) {
      if (this.eventListeners[eventType]) {
        this.eventListeners[eventType] = this.eventListeners[eventType].filter(
          listener => listener !== callback
        );
      }
    }
  
    notifyListeners(eventType, data) {
      if (this.eventListeners[eventType]) {
        this.eventListeners[eventType].forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error(`Error in ${eventType} event listener:`, error);
          }
        });
      }
    }
  }
  
  // Data Processing Utilities
  class DataProcessor {
    static processReadingsForChart(readings, timeRange = '1h') {
      if (!readings || readings.length === 0) return [];
  
      const now = new Date();
      const cutoffTime = this.getTimeRangeStart(now, timeRange);
      
      // Filter readings within time range
      const filteredReadings = readings.filter(reading => {
        const readingTime = new Date(reading.timestamp);
        return readingTime >= cutoffTime;
      });
  
      // Format for chart display
      return filteredReadings.map(reading => ({
        time: new Date(reading.timestamp).toLocaleTimeString('en-US', { 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        timestamp: reading.timestamp,
        bloodLoss: reading.blood_loss_ml,
        rate: reading.rate_ml_per_min,
        classification: this.classifyBloodLoss(reading.blood_loss_ml)
      }));
    }
  
    static getTimeRangeStart(now, timeRange) {
      const ranges = {
        '5m': 5 * 60 * 1000,
        '10m': 10 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '2h': 2 * 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '12h': 12 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '48h': 48 * 60 * 60 * 1000
      };
  
      const milliseconds = ranges[timeRange] || ranges['1h'];
      return new Date(now.getTime() - milliseconds);
    }
  
    static classifyBloodLoss(bloodLossMl) {
      if (bloodLossMl >= 500) return { level: 'Major Hemorrhage', color: '#ef4444', severity: 4 };
      if (bloodLossMl >= 250) return { level: 'Moderate Hemorrhage', color: '#f97316', severity: 3 };
      if (bloodLossMl >= 100) return { level: 'Minor Hemorrhage', color: '#eab308', severity: 2 };
      return { level: 'Normal bleeding', color: '#22c55e', severity: 1 };
    }
  
    static calculateTrendMetrics(readings) {
      if (!readings || readings.length < 2) {
        return { trend: 'stable', rate: 0, acceleration: 0 };
      }
  
      const recent = readings.slice(-5); // Last 5 readings
      const volumes = recent.map(r => r.blood_loss_ml);
      const times = recent.map(r => new Date(r.timestamp).getTime());
  
      // Calculate average rate of change
      let totalRateChange = 0;
      let rateCount = 0;
  
      for (let i = 1; i < recent.length; i++) {
        const timeDiff = (times[i] - times[i-1]) / (1000 * 60); // minutes
        const volumeDiff = volumes[i] - volumes[i-1];
        if (timeDiff > 0) {
          totalRateChange += volumeDiff / timeDiff;
          rateCount++;
        }
      }
  
      const averageRate = rateCount > 0 ? totalRateChange / rateCount : 0;
  
      // Determine trend direction
      let trend = 'stable';
      if (averageRate > 10) trend = 'rapid_increase';
      else if (averageRate > 5) trend = 'increasing';
      else if (averageRate > 1) trend = 'slow_increase';
      else if (averageRate < -1) trend = 'decreasing';
  
      // Calculate acceleration (rate of rate change)
      let acceleration = 0;
      if (recent.length >= 3) {
        const midPoint = Math.floor(recent.length / 2);
        const firstHalf = recent.slice(0, midPoint + 1);
        const secondHalf = recent.slice(midPoint);
  
        const firstRate = this.calculateSimpleRate(firstHalf);
        const secondRate = this.calculateSimpleRate(secondHalf);
        
        acceleration = secondRate - firstRate;
      }
  
      return {
        trend,
        rate: Math.round(averageRate * 100) / 100,
        acceleration: Math.round(acceleration * 100) / 100
      };
    }
  
    static calculateSimpleRate(readings) {
      if (readings.length < 2) return 0;
      
      const first = readings[0];
      const last = readings[readings.length - 1];
      const timeDiff = (new Date(last.timestamp) - new Date(first.timestamp)) / (1000 * 60);
      const volumeDiff = last.blood_loss_ml - first.blood_loss_ml;
      
      return timeDiff > 0 ? volumeDiff / timeDiff : 0;
    }
  
    static generateAlarmPattern(hemorrhageLevel, alertType) {
      // Define alarm patterns for different situations
      const patterns = {
        normal: { beeps: 1, interval: 5000, tone: 'low' },
        minor: { beeps: 2, interval: 3000, tone: 'medium' },
        moderate: { beeps: 3, interval: 2000, tone: 'high' },
        major: { beeps: 5, interval: 1000, tone: 'critical' },
        critical: { beeps: 'continuous', interval: 500, tone: 'emergency' }
      };
  
      return patterns[hemorrhageLevel] || patterns.normal;
    }
  
    static formatTimeAgo(timestamp) {
      const now = new Date();
      const past = new Date(timestamp);
      const diffMs = now - past;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
  
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${diffDays}d ago`;
    }
  
    static exportPatientData(patientInfo, readings, alerts) {
      const exportData = {
        patient: patientInfo,
        readings: readings.map(r => ({
          ...r,
          classification: this.classifyBloodLoss(r.blood_loss_ml)
        })),
        alerts: alerts,
        summary: {
          total_readings: readings.length,
          max_blood_loss: Math.max(...readings.map(r => r.blood_loss_ml), 0),
          monitoring_duration: readings.length > 0 ? 
            new Date(readings[readings.length - 1].timestamp) - new Date(readings[0].timestamp) : 0,
          alert_count: alerts.length,
          export_timestamp: new Date().toISOString()
        }
      };
  
      return exportData;
    }
  }
  
  // React Hook for API integration
  const useHemoDropAPI = () => {
    const [api] = useState(() => new HemoDropAPI());
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState(null);
  
    useEffect(() => {
      // Set up event listeners
      const handleConnection = (data) => {
        setIsConnected(data.status === 'connected');
        if (data.status === 'connected') {
          setConnectionError(null);
        }
      };
  
      const handleError = (data) => {
        setConnectionError(data.error);
      };
  
      api.addEventListener('connection', handleConnection);
      api.addEventListener('error', handleError);
  
      // Connect WebSocket
      api.connectWebSocket();
  
      // Cleanup
      return () => {
        api.removeEventListener('connection', handleConnection);
        api.removeEventListener('error', handleError);
        api.disconnectWebSocket();
      };
    }, [api]);
  
    return {
      api,
      isConnected,
      connectionError
    };
  };
  
  // Simulation Data Generator (for development/testing)
  class SimulationDataGenerator {
    static generatePatient(id) {
      const names = ['Jane Doe', 'Mary Smith', 'Sarah Johnson', 'Emily Davis', 'Lisa Wilson'];
      const deliveryTypes = ['vaginal', 'cesarean'];
      const stages = ['active', 'complete', 'postpartum'];
  
      return {
        patient_id: `patient_${id.toString().padStart(3, '0')}`,
        name: names[Math.floor(Math.random() * names.length)],
        date_of_birth: new Date(1985 + Math.floor(Math.random() * 15), 
          Math.floor(Math.random() * 12), 
          Math.floor(Math.random() * 28) + 1).toISOString(),
        gravidity: Math.floor(Math.random() * 5) + 1,
        parity: Math.floor(Math.random() * 4),
        room_number: (100 + Math.floor(Math.random() * 50)).toString(),
        bed_id: String.fromCharCode(65 + Math.floor(Math.random() * 4)), // A-D
        delivery_type: deliveryTypes[Math.floor(Math.random() * deliveryTypes.length)],
        delivery_stage: stages[Math.floor(Math.random() * stages.length)],
        created_at: new Date().toISOString()
      };
    }
  
    static generateReadings(patientId, count = 50) {
      const readings = [];
      const startTime = Date.now() - (count * 2 * 60 * 1000); // 2 minutes apart
      
      let cumulativeBloodLoss = Math.random() * 20; // Start with small amount
      
      for (let i = 0; i < count; i++) {
        const timestamp = new Date(startTime + (i * 2 * 60 * 1000));
        
        // Simulate realistic bleeding patterns
        let increment;
        if (i < count * 0.3) {
          // Early stage - slow bleeding
          increment = Math.random() * 2 + 0.5;
        } else if (i < count * 0.7) {
          // Middle stage - moderate increase
          increment = Math.random() * 5 + 1;
        } else {
          // Later stage - potentially rapid increase
          increment = Math.random() * 15 + 2;
        }
        
        cumulativeBloodLoss += increment;
        
        // Calculate rate from previous reading
        const rate = i === 0 ? increment / 2 : increment / 2; // mL per minute
        
        readings.push({
          patient_id: patientId,
          timestamp: timestamp.toISOString(),
          blood_loss_ml: Math.round(cumulativeBloodLoss * 10) / 10,
          rate_ml_per_min: Math.round(rate * 100) / 100,
          device_id: 'hemodrop_001',
          raw_weight_grams: Math.round(cumulativeBloodLoss * 1.05 * 10) / 10,
          temperature_celsius: 37.0 + (Math.random() - 0.5) * 0.5
        });
      }
      
      return readings;
    }
  
    static generateAlert(patientId, bloodLoss) {
      const classification = DataProcessor.classifyBloodLoss(bloodLoss);
      const alertTypes = ['info', 'warning', 'critical', 'emergency'];
      const alertType = alertTypes[Math.min(classification.severity - 1, alertTypes.length - 1)];
  
      return {
        alert_id: `alert_${patientId}_${Date.now()}`,
        patient_id: patientId,
        alert_type: alertType,
        message: classification.level,
        hemorrhage_level: classification.level.toLowerCase().replace(' hemorrhage', ''),
        blood_loss_ml: bloodLoss,
        timestamp: new Date().toISOString(),
        acknowledged: false
      };
    }
  }
  
  // Configuration for different environments
  const CONFIG = {
    development: {
      simulationMode: true,
      updateInterval: 2000, // 2 seconds
      maxReadingsToKeep: 500,
      enableAlarmSounds: false
    },
    production: {
      simulationMode: false,
      updateInterval: 30000, // 30 seconds
      maxReadingsToKeep: 2000,
      enableAlarmSounds: true
    }
  };
  
  // Export everything for use in React components
  export {
    HemoDropAPI,
    DataProcessor,
    SimulationDataGenerator,
    useHemoDropAPI,
    CONFIG
  };
  
  // Example usage in a React component:
  /*
  import { useHemoDropAPI, DataProcessor } from './api';
  
  const MonitoringComponent = () => {
    const { api, isConnected } = useHemoDropAPI();
    const [readings, setReadings] = useState([]);
    const [alerts, setAlerts] = useState([]);
  
    useEffect(() => {
      const handleReading = (reading) => {
        setReadings(prev => [...prev.slice(-99), reading]); // Keep last 100
      };
  
      const handleAlert = (alert) => {
        setAlerts(prev => [...prev, alert]);
        // Trigger alarm sound/visual alert
      };
  
      api.addEventListener('reading', handleReading);
      api.addEventListener('alert', handleAlert);
  
      return () => {
        api.removeEventListener('reading', handleReading);
        api.removeEventListener('alert', handleAlert);
      };
    }, [api]);
  
    // Process data for charts
    const chartData = DataProcessor.processReadingsForChart(readings, '1h');
    
    return (
      <div>
        <div>Connection: {isConnected ? 'Connected' : 'Disconnected'}</div>
        <div>Latest Reading: {readings[readings.length - 1]?.blood_loss_ml || 0}mL</div>
        // ... rest of your component
      </div>
    );
  };
  */