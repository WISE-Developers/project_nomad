/**
 * About Modal
 *
 * Shows app info from package.json and a contributors list
 * with clickable GitHub profile links.
 *
 * "FireSTARR" in the description is a link — hovering it
 * shows a secondary About popover for the FireSTARR engine.
 */

import React, { useState, useRef } from 'react';
import { version } from '../../package.json';

interface Contributor {
  name: string;
  github: string;
}

const NOMAD_CONTRIBUTORS: Contributor[] = [
  { name: 'Franco Nogarin', github: 'spydmobile' },
];

const FIRESTARR_CONTRIBUTORS: Contributor[] = [
  { name: 'Jordan Evens', github: 'jordan-evens' },
  { name: 'Shreeram Senthivasan', github: 'shreeramsenthi' },
  { name: 'Brett M', github: 'BadgerOnABike' },
];

interface AboutModalProps {
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20000,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#1f2937',
  color: 'white',
  borderRadius: '12px',
  padding: '32px',
  width: 'calc(100% - 32px)',
  maxWidth: '420px',
  boxSizing: 'border-box',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  textAlign: 'center',
};

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  backgroundColor: '#1f2937',
  color: 'white',
  borderRadius: '12px',
  padding: '24px',
  width: '360px',
  boxSizing: 'border-box',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  textAlign: 'center',
  border: '1px solid #374151',
  zIndex: 20001,
};

function ContributorList({ contributors }: { contributors: Contributor[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
      {contributors.map((c) => (
        <a
          key={c.github}
          href={`https://github.com/${c.github}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#e2e8f0',
            textDecoration: 'none',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <img
            src={`https://github.com/${c.github}.png?size=32`}
            alt={c.name}
            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
          />
          {c.name}
          <span style={{ color: '#64748b', fontSize: '12px' }}>@{c.github}</span>
        </a>
      ))}
    </div>
  );
}

function FireSTARRPopover() {
  return (
    <div>
      {/* Logo */}
      <img
        src="https://raw.githubusercontent.com/CWFMF/FireSTARR/main/img/FireSTARR.png"
        alt="FireSTARR"
        style={{ width: '64px', height: 'auto', borderRadius: '16px', marginBottom: '12px' }}
      />

      <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 700 }}>
        FireSTARR
      </h2>
      <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#94a3b8' }}>
        Fire Simulation Tool for Analysis, Research &amp; Reporting
      </p>
      <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#64748b' }}>
        AGPL-3.0 License
      </p>

      <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 16px 0' }}>
        A fire growth model based on the Canadian Forest Fire Danger Rating System
        and other fire research.
      </p>

      {/* Links */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px' }}>
        <a
          href="https://github.com/CWFMF/firestarr"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}
        >
          <i className="fa-brands fa-github" style={{ marginRight: '6px' }} />
          GitHub
        </a>
        <a
          href="https://github.com/CWFMF/firestarr/issues"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}
        >
          <i className="fa-solid fa-bug" style={{ marginRight: '6px' }} />
          Issues
        </a>
      </div>

      {/* Contributors */}
      <div style={{ borderTop: '1px solid #374151', paddingTop: '12px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Contributors
        </h3>
        <ContributorList contributors={FIRESTARR_CONTRIBUTORS} />
      </div>
    </div>
  );
}

export function AboutModal({ onClose }: AboutModalProps) {
  const [showFireSTARR, setShowFireSTARR] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const popoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleFireSTARREnter = () => {
    if (popoverTimeoutRef.current) clearTimeout(popoverTimeoutRef.current);
    setShowFireSTARR(true);
  };

  const handleFireSTARRLeave = () => {
    popoverTimeoutRef.current = setTimeout(() => setShowFireSTARR(false), 300);
  };

  const handlePopoverEnter = () => {
    if (popoverTimeoutRef.current) clearTimeout(popoverTimeoutRef.current);
  };

  const handlePopoverLeave = () => {
    popoverTimeoutRef.current = setTimeout(() => setShowFireSTARR(false), 300);
  };

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        {/* Logo */}
        <img
          src="/nomad-logo.png"
          alt="Project Nomad"
          style={{ width: '80px', height: 'auto', borderRadius: '16px', marginBottom: '16px' }}
        />

        {/* Title */}
        <h2 style={{ margin: '0 0 4px 0', fontSize: '24px', fontWeight: 700 }}>
          Project Nomad
        </h2>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#94a3b8' }}>
          Fire Modeling System
        </p>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
          v{version} &middot; AGPL-3.0 License
        </p>

        {/* Description — FireSTARR is a hover link */}
        <p style={{ fontSize: '14px', color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 20px 0', position: 'relative' }}>
          A map-based fire modeling GUI supporting{' '}
          <a
            ref={linkRef}
            href="https://github.com/CWFMF/firestarr"
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={handleFireSTARREnter}
            onMouseLeave={handleFireSTARRLeave}
            style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: 600, cursor: 'pointer' }}
          >
            FireSTARR
          </a>{' '}
          probabilistic and deterministic fire growth simulations for Canadian wildfire management.
        </p>

        {/* FireSTARR hover popover */}
        {showFireSTARR && (
          <div
            style={{
              ...popoverStyle,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={handlePopoverLeave}
          >
            <FireSTARRPopover />
          </div>
        )}

        {/* Links */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '24px' }}>
          <a
            href="https://github.com/WISE-Developers/project_nomad"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}
          >
            <i className="fa-brands fa-github" style={{ marginRight: '6px' }} />
            GitHub
          </a>
          <a
            href="https://github.com/WISE-Developers/project_nomad/blob/main/CHANGES.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}
          >
            <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: '6px' }} />
            Changelog
          </a>
          <a
            href="https://github.com/WISE-Developers/project_nomad/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}
          >
            <i className="fa-solid fa-bug" style={{ marginRight: '6px' }} />
            Report Issue
          </a>
        </div>

        {/* Contributors */}
        <div style={{ borderTop: '1px solid #374151', paddingTop: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Source Code Contributors
          </h3>
          <ContributorList contributors={NOMAD_CONTRIBUTORS} />
        </div>

        {/* OK button */}
        <button
          onClick={onClose}
          style={{
            padding: '10px 32px',
            fontSize: '14px',
            fontWeight: 600,
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
