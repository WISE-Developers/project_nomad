/**
 * Splash Screen Component
 *
 * Branded welcome screen shown on app load.
 * Requires click to dismiss.
 */

interface SplashScreenProps {
  onEnter: () => void;
}

export function SplashScreen({ onEnter }: SplashScreenProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        cursor: 'pointer',
      }}
      onClick={onEnter}
    >
      {/* Logo */}
      <img
        src="/nomad-logo.png"
        alt="Project Nomad"
        style={{
          width: '200px',
          height: 'auto',
          marginBottom: '32px',
          borderRadius: '24px',
        }}
      />

      {/* Title */}
      <h1
        style={{
          color: '#ffffff',
          fontSize: '48px',
          fontWeight: 700,
          margin: '0 0 8px 0',
          textAlign: 'center',
        }}
      >
        Project Nomad
      </h1>

      {/* Subtitle */}
      <p
        style={{
          color: '#94a3b8',
          fontSize: '20px',
          margin: '0 0 48px 0',
          textAlign: 'center',
        }}
      >
        Fire Modeling System<br />
        MVP Prototype v0.0<br />
        SAN Mode (Stand Alone Nomad)

      </p>

      {/* Enter prompt */}
      <div
        style={{
          color: '#64748b',
          fontSize: '16px',
          animation: 'pulse 2s infinite',
        }}
      >
        Click anywhere to enter
      </div>

      {/* Pulse animation */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  );
}
