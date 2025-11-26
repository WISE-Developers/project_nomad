import { useEffect, useState } from 'react';

interface ApiInfo {
  name: string;
  version: string;
  description: string;
}

interface HealthStatus {
  status: string;
  service: string;
  timestamp: string;
}

function App() {
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [apiRes, healthRes] = await Promise.all([
          fetch('/api'),
          fetch('/api/health'),
        ]);

        if (apiRes.ok) {
          setApiInfo(await apiRes.json());
        }
        if (healthRes.ok) {
          setHealth(await healthRes.json());
        }
      } catch {
        setError('Backend not connected. Start with: cd backend && npm run dev');
      }
    };

    fetchData();
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Project Nomad</h1>
        <img src="/nomad-logo.png" alt="Nomad Logo" className="logo" />
        <p className="subtitle">Fire Modeling System</p>
      </header>

      <main>
        <section className="status-card">
          <h2>System Status</h2>

          {error ? (
            <div className="error">{error}</div>
          ) : (
            <>
              {apiInfo && (
                <div className="info-block">
                  <h3>API</h3>
                  <p>
                    <strong>{apiInfo.name}</strong> v{apiInfo.version}
                  </p>
                  <p>{apiInfo.description}</p>
                </div>
              )}

              {health && (
                <div className="info-block">
                  <h3>Health</h3>
                  <p>
                    Status:{' '}
                    <span className={`status-${health.status}`}>
                      {health.status}
                    </span>
                  </p>
                  <p>Service: {health.service}</p>
                </div>
              )}

              {!apiInfo && !health && (
                <p className="loading">Connecting to backend...</p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
