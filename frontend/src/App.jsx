import React, { useEffect, useState } from "react";
import { api, getStoredToken, setStoredToken } from "./api/client";
import { AuthView } from "./components/AuthView";
import { CustomerPortal } from "./components/CustomerPortal";
import { StaffConsole } from "./components/StaffConsole";

export function App() {
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBootstrapping(false);
      return;
    }
    api
      .me()
      .then((u) => setUser(u))
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setBootstrapping(false));
  }, []);

  const handleAuthenticated = (auth) => {
    setStoredToken(auth.access_token);
    setUser(auth.user);
  };

  const handleLogout = () => {
    void api.logout().catch(() => {});
    setStoredToken(null);
    setUser(null);
  };

  if (bootstrapping) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-secondary)",
          fontSize: 14,
        }}
      >
        Restoring Kestrel workspace session...
      </div>
    );
  }

  if (!user) {
    return <AuthView onAuthenticated={handleAuthenticated} />;
  }

  if (user.role === "support_agent" || user.role === "admin") {
    return <StaffConsole user={user} onLogout={handleLogout} />;
  }

  return <CustomerPortal user={user} onLogout={handleLogout} />;
}

export default App;
