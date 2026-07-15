import { useState, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Search } from 'lucide-react';
import { FT_DEPARTMENTS } from './ftConstants';

const GRADIENTS = [
  'linear-gradient(135deg, #0d9488, #0891b2)',
  'linear-gradient(135deg, #7c3aed, #4f46e5)',
  'linear-gradient(135deg, #059669, #10b981)',
  'linear-gradient(135deg, #d97706, #f59e0b)',
  'linear-gradient(135deg, #dc2626, #f43f5e)',
  'linear-gradient(135deg, #2563eb, #3b82f6)',
];

export default function FTDashboard() {
  const { places, registrations, creditData, userRole } = useOutletContext();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');

  const myRegPlaceIds = useMemo(() => {
    if (!registrations) return new Set();
    const storedUid = localStorage.getItem('ft_userId') || sessionStorage.getItem('ft_userId');
    return new Set(registrations.filter(r => r.studentId === storedUid).map(r => r.placeId));
  }, [registrations]);

  const filteredPlaces = useMemo(() => {
    if (!places) return [];
    return places.filter(p => {
      const isStaff = userRole === 'admin' || userRole === 'master' || userRole === 'trainer' || userRole === 'faculty';
      if (!isStaff && p.isVisible === false) {
        const isRegistered = myRegPlaceIds.has(p.id);
        if (!isRegistered) return false;
      }

      const matchSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase());
      const matchDept = deptFilter === 'All' || p.department === deptFilter;
      return matchSearch && matchDept;
    });
  }, [places, search, deptFilter, userRole, myRegPlaceIds]);

  if (!places) {
    return (
      <div>
        <div className="ft-page-header">
          <div className="ft-skeleton" style={{ width: '260px', height: '32px', marginBottom: '0.5rem' }} />
          <div className="ft-skeleton" style={{ width: '360px', height: '18px' }} />
        </div>
        <div className="ft-places-grid">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="ft-place-card">
              <div className="ft-skeleton" style={{ height: '180px' }} />
              <div style={{ padding: '1.25rem' }}>
                <div className="ft-skeleton" style={{ height: '20px', width: '70%', marginBottom: '0.5rem' }} />
                <div className="ft-skeleton" style={{ height: '14px', width: '100%', marginBottom: '0.3rem' }} />
                <div className="ft-skeleton" style={{ height: '14px', width: '80%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="ft-page-header">
        <h1 className="ft-page-title">Training Places</h1>
        <p className="ft-page-subtitle">
          Browse available field training placements and register for the ones that interest you.
          {creditData && (
            <span style={{ display: 'inline-block', marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--ft-primary)', fontWeight: 600 }}>
              ({creditData.required} credit hours required)
            </span>
          )}
        </p>
      </div>

      {/* Search & Filter */}
      <div className="ft-search-bar">
        <div className="ft-search-input-wrapper">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search training places..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="ft-filter-chips">
          <button className={`ft-chip ${deptFilter === 'All' ? 'active' : ''}`} onClick={() => setDeptFilter('All')}>All</button>
          {FT_DEPARTMENTS.map(dept => (
            <button key={dept} className={`ft-chip ${deptFilter === dept ? 'active' : ''}`} onClick={() => setDeptFilter(dept)}>
              {dept}
            </button>
          ))}
        </div>
      </div>

      {/* Place Cards Grid */}
      {filteredPlaces.length === 0 ? (
        <div className="ft-empty">
          <div className="ft-empty-icon">🗺️</div>
          <div className="ft-empty-title">No Places Found</div>
          <div className="ft-empty-text">
            {search || deptFilter !== 'All'
              ? 'Try adjusting your search or filter criteria.'
              : 'No training places have been added yet. Check back soon!'}
          </div>
        </div>
      ) : (
        <div className="ft-places-grid">
          {filteredPlaces.map((place, idx) => {
            const isRegistered = myRegPlaceIds.has(place.id);
            return (
              <div
                key={place.id}
                className="ft-place-card ft-animate-in"
                style={{ animationDelay: `${idx * 0.05}s` }}
                onClick={() => navigate(`/place/${place.id}`)}
              >
                <div className="ft-place-card-image-wrapper">
                  {place.image ? (
                    <img src={place.image} alt={place.name} className="ft-place-card-image" />
                  ) : (
                    <div className="ft-place-card-image-fallback" style={{ background: GRADIENTS[idx % GRADIENTS.length] }}>
                      <span style={{ fontSize: '3rem', filter: 'brightness(2)' }}>🏢</span>
                    </div>
                  )}
                  <div className="ft-place-card-hours-badge">
                    {place.creditHours || 0} Credit Hours
                  </div>
                  {isRegistered && (
                    <div style={{
                      position: 'absolute', top: 12, left: 12,
                      background: 'rgba(34, 197, 94, 0.92)',
                      backdropFilter: 'blur(8px)',
                      color: 'white', fontWeight: 700, fontSize: '0.75rem',
                      padding: '0.3rem 0.75rem', borderRadius: 'var(--ft-radius-full)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                    }}>
                      ✓ Registered
                    </div>
                  )}
                  {place.isVisible === false && (
                    <div style={{
                      position: 'absolute', top: 12, left: isRegistered ? 110 : 12,
                      background: 'rgba(239, 68, 68, 0.92)',
                      backdropFilter: 'blur(8px)',
                      color: 'white', fontWeight: 700, fontSize: '0.75rem',
                      padding: '0.3rem 0.75rem', borderRadius: 'var(--ft-radius-full)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                    }}>
                      Hidden
                    </div>
                  )}
                </div>
                <div className="ft-place-card-body">
                  <div className="ft-place-card-name">{place.name}</div>
                  <div className="ft-place-card-desc">{place.description || 'No description available.'}</div>
                  <div className="ft-place-card-footer">
                    {place.department && <span className="ft-place-card-dept">{place.department}</span>}
                    {(() => {
                      const placeRegs = registrations?.filter(r => r.placeId === place.id && r.status !== 'failed' && !r.isTest) || [];
                      let remaining = 0;
                      let hasDefinedCapacity = false;

                      if (place.hasPrograms && place.programs) {
                        place.programs.forEach(prog => {
                          const progRegs = placeRegs.filter(r => r.programId === prog.id);
                          if (prog.waves && prog.waves.length > 0) {
                            hasDefinedCapacity = true;
                            prog.waves.forEach(w => {
                              const waveRegsCount = progRegs.filter(r => r.waveId === w.id).length;
                              const wCap = parseInt(w.capacity) || 0;
                              remaining += Math.max(0, wCap - waveRegsCount);
                            });
                          } else {
                            const pCap = parseInt(prog.capacity) || 0;
                            if (pCap > 0) hasDefinedCapacity = true;
                            remaining += Math.max(0, pCap - progRegs.length);
                          }
                        });
                      } else if (place.waves && place.waves.length > 0) {
                        hasDefinedCapacity = true;
                        place.waves.forEach(w => {
                          const waveRegsCount = placeRegs.filter(r => r.waveId === w.id).length;
                          const wCap = parseInt(w.capacity) || 0;
                          remaining += Math.max(0, wCap - waveRegsCount);
                        });
                      } else {
                        const pCap = parseInt(place.capacity) || 0;
                        if (pCap > 0) hasDefinedCapacity = true;
                        remaining = Math.max(0, pCap - placeRegs.length);
                      }

                      if (!hasDefinedCapacity) return null;

                      return (
                        <span className="ft-place-card-spots" style={remaining <= 0 ? { color: 'var(--ft-danger)', fontWeight: 700 } : {}}>
                          {remaining > 0 ? `${remaining} spots left` : 'Full'}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
