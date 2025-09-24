import React from "react";
import { MonitoringProvider } from "./store/MonitoringContext";
import HemoDropDashboard from "./components/HemoDropDashboard";

const App = () => {
  return (
    <MonitoringProvider>
      <HemoDropDashboard />
    </MonitoringProvider>
  );
};

export default App;
