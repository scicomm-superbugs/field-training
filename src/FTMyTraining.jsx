import { useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { BookOpen, Target, CheckCircle, ArrowRight } from 'lucide-react';
import { FT_REG_STATUS_ICONS, FT_REG_STATUS_LABELS, FT_REG_STATUS_COLORS } from './ftConstants';

export default function FTMyTraining() {
  const { creditData, registrations, places } = useOutletContext();
  const navigate = useNavigate();
  const userId = localStorage.getItem('ft_userId') || sessionStorage.getItem('ft_userId');

  const myRegs = useMemo(() => {
    if (!registrations || !places) return [];
    return registrations
      .filter(r => r.studentId === userId)
      .map(r => {
        const place = places.find(p => p.id === r.placeId);
        return { ...r, place };
      })
      .sort((a, b) => {
        const order = { active: 0, pending: 1, completed: 2, failed: 3 };
        return (order[a.status] || 4) - (order[b.status] || 4);
      });
  }, [registrations, places, userId]);

  const progressPct = creditData.required > 0 ? Math.min(100, Math.round((creditData.completed / creditData.required) * 100)) : 0;

  const circumference = 2 * Math.PI * 60;
  const dashOffset = circumference - (progressPct / 100) * circumference;

  return (
    <div className="ft-animate-in">
      <div className="ft-page-header">
        <h1 className="ft-page-title">My Training</h1>
        <p className="ft-page-subtitle">Track your field training progress and registrations.</p>
      </div>

      {/* Credit Hours Overview */}
      <div className="ft-card" style={{ marginBottom: '2rem', padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifycontent: 'center', gap: '3rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Progress Ring */}
          <div className="ft-progress-ring" style={{ width: '160px', height: '160px' }}>
            <svg width="160" height="160">
              <circle className="ft-progress-ring-bg" cx="80" cy="80" r="60" />
              <circle
                className="ft-progress-ring-fill"
                cx="80" cy="80" r="60"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ stroke: progressPct >= 100 ? 'var(--ft-success)' : 'var(--ft-primary)' }}
              />
            </svg>
            <div className="ft-progress-ring-text" style={{ color: progressPct >= 100 ? 'var(--ft-success)' : 'var(--ft-text)' }}>
              {progressPct}%
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: 'var(--ft-radius)', background: 'var(--ft-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Target size={22} style={{ color: 'var(--ft-primary)' }} />
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontFamily: "'Outfit', sans-serif", fontWeight: 800 }}>{creditData.required}h</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>Required Hours</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: 'var(--ft-radius)', background: 'var(--ft-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BookOpen size={22} style={{ color: 'var(--ft-info)' }} />
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontFamily: "'Outfit', sans-serif", fontWeight: 800, color: 'var(--ft-info)' }}>{creditData.registered}h</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>Registered Hours</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: 'var(--ft-radius)', background: 'var(--ft-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle size={22} style={{ color: 'var(--ft-success)' }} />
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontFamily: "'Outfit', sans-serif", fontWeight: 800, color: 'var(--ft-success)' }}>{creditData.completed}h</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>Completed Hours</div>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            <span style={{ color: 'var(--ft-text-muted)' }}>Overall Progress</span>
            <span style={{ color: progressPct >= 100 ? 'var(--ft-success)' : 'var(--ft-primary)' }}>
              {creditData.completed} / {creditData.required} hours
            </span>
          </div>
          <div className="ft-progress-bar">
            <div className="ft-progress-bar-fill" style={{
              width: `${progressPct}%`,
              background: progressPct >= 100
                ? 'linear-gradient(90deg, var(--ft-success), #4ade80)'
                : 'linear-gradient(90deg, var(--ft-primary), var(--ft-primary-light))'
            }} />
          </div>
        </div>

        {progressPct >= 100 && (
          <div style={{ marginTop: '1.25rem', padding: '0.75rem 1rem', background: 'var(--ft-success-bg)', borderRadius: 'var(--ft-radius)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--ft-success)', fontWeight: 600, fontSize: '0.88rem' }}>
            🎉 Congratulations! You've completed all required field training hours!
          </div>
        )}
      </div>

      {/* My Registrations */}
      <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
        My Registrations ({myRegs.length})
      </h2>

      {myRegs.length === 0 ? (
        <div className="ft-empty">
          <div className="ft-empty-icon">📋</div>
          <div className="ft-empty-title">No Registrations Yet</div>
          <div className="ft-empty-text">You haven't registered for any training places. Browse available places to get started!</div>
          <button className="ft-btn ft-btn-primary" onClick={() => navigate('/')}>Browse Training Places</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {myRegs.map((reg, idx) => (
            <div
              key={reg.id}
              className="ft-card ft-animate-in"
              style={{
                animationDelay: `${idx * 0.05}s`,
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                cursor: 'pointer',
                borderLeft: `4px solid ${FT_REG_STATUS_COLORS[reg.status] || 'var(--ft-border)'}`,
              }}
              onClick={() => navigate(`/place/${reg.placeId}`)}
            >
              {/* Icon */}
              <div style={{ width: '48px', height: '48px', borderRadius: 'var(--ft-radius)', overflow: 'hidden', flexShrink: 0 }}>
                {reg.place?.image ? (
                  <img src={reg.place.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: 'var(--ft-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem' }}>🏢</div>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.15rem' }}>{reg.placeName || reg.place?.name || 'Unknown Place'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span className={`ft-badge ft-badge-${reg.status}`}>
                    {FT_REG_STATUS_ICONS[reg.status]} {FT_REG_STATUS_LABELS[reg.status]}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)' }}>
                    {reg.place?.creditHours || reg.creditHours || 0} credit hours
                  </span>
                  {reg.waveName && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--ft-primary)', fontWeight: 600, background: 'var(--ft-primary-bg)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                      🌊 {reg.waveName}
                    </span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <ArrowRight size={18} style={{ color: 'var(--ft-text-muted)', flexShrink: 0 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
