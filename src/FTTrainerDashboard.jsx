import { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, firestore, getCollectionName } from './db';
import { collection, getDocs } from 'firebase/firestore';
import { ClipboardCheck, CheckCircle, XCircle, X, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { FT_REG_STATUS_ICONS, FT_REG_STATUS_LABELS, cleanWaveName } from './ftConstants';

export default function FTTrainerDashboard() {
  const { places, registrations, meDoc } = useOutletContext();
  const userId = localStorage.getItem('ft_userId') || sessionStorage.getItem('ft_userId');

  const [evaluations, setEvaluations] = useState([]);
  const [students, setStudents] = useState({});
  const [showEvalModal, setShowEvalModal] = useState(null);
  const [evalForm, setEvalForm] = useState({ score: '', passed: true, comments: '' });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDeleteRegId, setConfirmDeleteRegId] = useState(null);

  const [search, setSearch] = useState('');
  const [collapsedPlaces, setCollapsedPlaces] = useState({});
  const [scientists, setScientists] = useState([]);

  // Find places assigned to this trainer
  const myPlaces = useMemo(() => {
    if (!places) return [];
    return places.filter(p => p.trainerIds?.includes(userId) || p.trainerId === userId);
  }, [places, userId]);

  const myPlaceIds = useMemo(() => new Set(myPlaces.map(p => p.id)), [myPlaces]);

  // Find registrations for my places
  const myRegistrations = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(r => myPlaceIds.has(r.placeId) && !r.isTest);
  }, [registrations, myPlaceIds]);

  // Load student details
  useEffect(() => {
    const loadStudents = async () => {
      const ids = [...new Set(myRegistrations.map(r => r.studentId))];
      const loaded = {};
      for (const id of ids) {
        if (!students[id]) {
          const s = await db.scientists.get(id);
          if (s) loaded[id] = s;
        }
      }
      if (Object.keys(loaded).length > 0) {
        setStudents(prev => ({ ...prev, ...loaded }));
      }
    };
    if (myRegistrations.length > 0) loadStudents();
  }, [myRegistrations]);

  // Load evaluations
  useEffect(() => {
    (async () => {
      const col = getCollectionName('ft_evaluations');
      const snap = await getDocs(collection(firestore, col));
      setEvaluations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    })();
  }, []);

  // Load all scientists (for Trainee dynamic name/department/avatar resolution)
  useEffect(() => {
    (async () => {
      try {
        const col = getCollectionName('scientists');
        const snap = await getDocs(collection(firestore, col));
        setScientists(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load scientists:', err);
      }
    })();
  }, []);

  const handleEvaluate = async () => {
    if (!showEvalModal) return;
    setSubmitting(true);
    try {
      await db.ft_evaluations.add({
        studentId: showEvalModal.studentId,
        placeId: showEvalModal.placeId,
        trainerId: userId,
        trainerName: meDoc?.name || '',
        score: evalForm.score ? parseInt(evalForm.score) : null,
        passed: evalForm.passed,
        comments: evalForm.comments.trim(),
        createdAt: new Date().toISOString(),
      });

      const newStatus = evalForm.passed ? 'completed' : 'failed';
      await db.ft_registrations.update(showEvalModal.id, {
        status: newStatus,
        evaluatedAt: new Date().toISOString(),
        evaluatedBy: userId,
      });

      setToast({ type: 'success', msg: `Student marked as ${evalForm.passed ? 'completed' : 'needs re-training'}.` });
      setShowEvalModal(null);
      setEvalForm({ score: '', passed: true, comments: '' });

      const col = getCollectionName('ft_evaluations');
      const snap = await getDocs(collection(firestore, col));
      setEvaluations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      setToast({ type: 'error', msg: 'Evaluation failed: ' + err.message });
    }
    setSubmitting(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleApprove = async (regId) => {
    try {
      await db.ft_registrations.update(regId, { status: 'active', approvedAt: new Date().toISOString(), approvedBy: userId });
      setToast({ type: 'success', msg: 'Registration approved!' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleRemoveStudent = async (regId) => {
    if (!window.confirm('Are you sure you want to remove this student? This will cancel their registration.')) return;
    try {
      await db.ft_registrations.delete(regId);
      setToast({ type: 'success', msg: 'Student removed successfully.' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to remove: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const activeCount = myRegistrations.filter(r => r.status === 'active').length;
  const pendingCount = myRegistrations.filter(r => r.status === 'pending').length;
  const completedCount = myRegistrations.filter(r => r.status === 'completed').length;

  const displayedPlaces = useMemo(() => {
    if (!search.trim()) return myPlaces;
    const searchLower = search.trim().toLowerCase();
    return myPlaces.filter(place => {
      if (place.name?.toLowerCase().includes(searchLower)) return true;
      const placeRegs = myRegistrations.filter(r => r.placeId === place.id);
      return placeRegs.some(reg => {
        const sci = scientists.find(s => 
          (reg.studentId && s.id === reg.studentId) ||
          (reg.studentUniversityId && s.universityId === reg.studentUniversityId) ||
          (reg.studentEmail && s.email?.toLowerCase() === reg.studentEmail.toLowerCase())
        );
        const dispName = sci?.name || reg.studentName || 'Imported Trainee (Pending Account)';
        const dispId = sci?.universityId || reg.studentUniversityId || '';
        return (
          dispName.toLowerCase().includes(searchLower) ||
          dispId.toLowerCase().includes(searchLower)
        );
      });
    });
  }, [myPlaces, myRegistrations, search, scientists]);

  const togglePlaceCollapse = (placeId) => {
    setCollapsedPlaces(prev => ({
      ...prev,
      [placeId]: !prev[placeId]
    }));
  };

  if (myPlaces.length === 0) {
    return (
      <div className="ft-animate-in">
        <div className="ft-page-header">
          <h1 className="ft-page-title">My Trainees</h1>
        </div>
        <div className="ft-empty">
          <div className="ft-empty-icon">📋</div>
          <div className="ft-empty-title">No Places Assigned</div>
          <div className="ft-empty-text">You haven't been assigned to any training places yet. Contact an administrator to get assigned.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ft-animate-in">
        <div className="ft-page-header">
          <h1 className="ft-page-title">My Trainees</h1>
          <p className="ft-page-subtitle">Manage and evaluate students at your assigned training place{myPlaces.length > 1 ? 's' : ''}.</p>
        </div>

        {/* Stats */}
        <div className="ft-stats-grid">
          <div className="ft-stat-card">
            <div className="ft-stat-icon" style={{ background: 'var(--ft-primary-bg)' }}>🏢</div>
            <div>
              <div className="ft-stat-value">{myPlaces.length}</div>
              <div className="ft-stat-label">My Places</div>
            </div>
          </div>
          <div className="ft-stat-card">
            <div className="ft-stat-icon" style={{ background: 'var(--ft-warning-bg)' }}>🟡</div>
            <div>
              <div className="ft-stat-value" style={{ color: 'var(--ft-warning)' }}>{pendingCount}</div>
              <div className="ft-stat-label">Pending Approval</div>
            </div>
          </div>
          <div className="ft-stat-card">
            <div className="ft-stat-icon" style={{ background: 'var(--ft-info-bg)' }}>🔵</div>
            <div>
              <div className="ft-stat-value" style={{ color: 'var(--ft-info)' }}>{activeCount}</div>
              <div className="ft-stat-label">In Training</div>
            </div>
          </div>
          <div className="ft-stat-card">
            <div className="ft-stat-icon" style={{ background: 'var(--ft-success-bg)' }}>✅</div>
            <div>
              <div className="ft-stat-value" style={{ color: 'var(--ft-success)' }}>{completedCount}</div>
              <div className="ft-stat-label">Completed</div>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="ft-search-input-wrapper">
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Search trainees by name, university ID or training place..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Per-Place Sections */}
        {displayedPlaces.map(place => {
          const placeRegs = myRegistrations.filter(r => r.placeId === place.id);
          
          const filteredPlaceRegs = placeRegs.filter(reg => {
            const sci = scientists.find(s => 
              (reg.studentId && s.id === reg.studentId) ||
              (reg.studentUniversityId && s.universityId === reg.studentUniversityId) ||
              (reg.studentEmail && s.email?.toLowerCase() === reg.studentEmail.toLowerCase())
            );
            const dispName = sci?.name || reg.studentName || 'Imported Trainee (Pending Account)';
            const dispId = sci?.universityId || reg.studentUniversityId || '';
            
            if (!search.trim()) return true;
            const searchLower = search.trim().toLowerCase();
            return (
              dispName.toLowerCase().includes(searchLower) ||
              dispId.toLowerCase().includes(searchLower) ||
              place.name?.toLowerCase().includes(searchLower)
            );
          });

          const isCollapsed = search.trim() ? false : !collapsedPlaces[place.id];

          return (
            <div key={place.id} className="ft-card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
              <div 
                onClick={() => togglePlaceCollapse(place.id)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: 'var(--ft-radius)', overflow: 'hidden', flexShrink: 0 }}>
                    {place.image ? (
                      <img src={place.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: 'var(--ft-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>🏢</div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem' }}>{place.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ft-text-muted)' }}>
                      {place.creditHours}h · {filteredPlaceRegs.length} trainee{filteredPlaceRegs.length !== 1 ? 's' : ''}
                      {placeRegs.length !== filteredPlaceRegs.length && ` (filtered from ${placeRegs.length})`}
                    </div>
                  </div>
                </div>
                <div style={{ color: 'var(--ft-text-muted)', paddingRight: '0.5rem' }}>
                  {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                </div>
              </div>

              {!isCollapsed && (
                <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--ft-border-light)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {filteredPlaceRegs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--ft-text-muted)', fontSize: '0.88rem' }}>
                      {placeRegs.length === 0 ? 'No trainees registered yet.' : 'No trainees matched your search.'}
                    </div>
                  ) : (
                    filteredPlaceRegs.map(reg => {
                      const sci = scientists.find(s => 
                        (reg.studentId && s.id === reg.studentId) ||
                        (reg.studentUniversityId && s.universityId === reg.studentUniversityId) ||
                        (reg.studentEmail && s.email?.toLowerCase() === reg.studentEmail.toLowerCase())
                      );
                      const dispName = sci?.name || reg.studentName || 'Imported Trainee (Pending Account)';
                      const dispEmail = sci?.email || reg.studentEmail || '';
                      const dispId = sci?.universityId || reg.studentUniversityId || '—';
                      const dispDept = sci?.department || reg.studentDepartment || '—';
                      const dispAvatar = sci?.avatar || null;

                      const regEvals = evaluations.filter(ev => ev.studentId === reg.studentId && ev.placeId === reg.placeId);
                      return (
                        <div key={reg.id} className="ft-eval-card">
                          <div className="ft-eval-avatar">
                            {dispAvatar ? (
                              <img src={dispAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--ft-radius-full)' }} />
                            ) : (
                              dispName[0].toUpperCase()
                            )}
                          </div>
                          <div className="ft-eval-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span className="ft-eval-name">{dispName}</span>
                              {dispId !== '—' && (
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ft-primary)', background: 'var(--ft-primary-bg)', padding: '0.05rem 0.35rem', borderRadius: '4px', border: '1px solid rgba(190, 18, 60, 0.12)' }}>
                                  {dispId}
                                </span>
                              )}
                            </div>
                            <div className="ft-eval-meta">
                              {dispDept} · 
                              <span className={`ft-badge ft-badge-${reg.status}`} style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>
                                {FT_REG_STATUS_ICONS[reg.status]} {FT_REG_STATUS_LABELS[reg.status]}
                              </span>
                              {reg.waveName && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--ft-primary)', fontWeight: 600, marginLeft: '0.5rem' }}>
                                  🌊 {cleanWaveName(reg.waveName)}
                                </span>
                              )}
                            </div>
                            {regEvals.length > 0 && (
                              <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', marginTop: '0.25rem' }}>
                                Last evaluation: {regEvals[regEvals.length - 1].passed ? '✅ Passed' : '❌ Failed'} 
                                {regEvals[regEvals.length - 1].score != null && ` · Score: ${regEvals[regEvals.length - 1].score}`}
                              </div>
                            )}
                          </div>
                          <div className="ft-eval-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {reg.status === 'pending' && (
                              <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={() => handleApprove(reg.id)} title="Approve">
                                <CheckCircle size={14} /> Approve
                              </button>
                            )}
                            {(reg.status === 'active' || reg.status === 'failed') && (
                              <button
                                className="ft-btn ft-btn-secondary ft-btn-sm"
                                onClick={() => {
                                  setShowEvalModal(reg);
                                  setEvalForm({ score: '', passed: true, comments: '' });
                                }}
                              >
                                <ClipboardCheck size={14} /> Evaluate
                              </button>
                            )}
                            <button
                              className="ft-btn ft-btn-secondary ft-btn-sm"
                              style={{ color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.15)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                              onClick={() => setConfirmDeleteRegId(reg.id)}
                              title="Remove student"
                            >
                              <XCircle size={14} /> Remove
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

    {/* Evaluation Modal */}
    {showEvalModal && (
      <div className="ft-modal-overlay">
        <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
          <div className="ft-modal-header">
            <h3 className="ft-modal-title">📝 Evaluate Student</h3>
            <button className="ft-btn ft-btn-ghost ft-btn-icon" onClick={() => setShowEvalModal(null)}><X size={18} /></button>
          </div>
          <div className="ft-modal-body">
            <div style={{ marginBottom: '1.25rem', padding: '0.75rem', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius)', fontSize: '0.88rem' }}>
              <strong>{students[showEvalModal.studentId]?.name || showEvalModal.studentName}</strong> at {showEvalModal.placeName || ''}
            </div>

            <div className="ft-input-group">
              <label className="ft-label">Result</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  className={`ft-btn ${evalForm.passed ? 'ft-btn-primary' : 'ft-btn-secondary'}`}
                  onClick={() => setEvalForm(f => ({ ...f, passed: true }))}
                  style={{ flex: 1 }}
                >
                  <CheckCircle size={16} /> Pass
                </button>
                <button
                  className={`ft-btn ${!evalForm.passed ? 'ft-btn-danger' : 'ft-btn-secondary'}`}
                  onClick={() => setEvalForm(f => ({ ...f, passed: false }))}
                  style={{ flex: 1 }}
                >
                  <XCircle size={16} /> Fail
                </button>
              </div>
            </div>

            <div className="ft-input-group">
              <label className="ft-label">Score (optional, 0-100)</label>
              <input className="ft-input" type="number" min="0" max="100" value={evalForm.score} onChange={e => setEvalForm(f => ({ ...f, score: e.target.value }))} placeholder="e.g. 85" />
            </div>

            <div className="ft-input-group">
              <label className="ft-label">Comments</label>
              <textarea className="ft-textarea" value={evalForm.comments} onChange={e => setEvalForm(f => ({ ...f, comments: e.target.value }))} placeholder="Add evaluation notes..." rows={3} />
            </div>
          </div>
          <div className="ft-modal-footer">
            <button className="ft-btn ft-btn-secondary" onClick={() => setShowEvalModal(null)}>Cancel</button>
            <button className="ft-btn ft-btn-primary" onClick={handleEvaluate} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Evaluation'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Delete Confirmation Modal */}
    {confirmDeleteRegId && (
      <div className="ft-modal-overlay">
        <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
          <div className="ft-modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>❌</div>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Remove Student?</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--ft-text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to remove this student? This will cancel their registration.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="ft-btn ft-btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmDeleteRegId(null)}>Cancel</button>
              <button className="ft-btn ft-btn-danger" style={{ flex: 1 }} onClick={async () => {
                const regId = confirmDeleteRegId;
                setConfirmDeleteRegId(null);
                try {
                  await db.ft_registrations.delete(regId);
                  setToast({ type: 'success', msg: 'Student removed successfully.' });
                } catch (err) {
                  setToast({ type: 'error', msg: 'Failed to remove: ' + err.message });
                }
                setTimeout(() => setToast(null), 3000);
              }}>Remove</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Toast */}
    {toast && (
      <div className={`ft-toast ft-toast-${toast.type}`}>
        <span>{toast.type === 'success' ? '✅' : '❌'}</span>
        <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{toast.msg}</span>
      </div>
    )}
  </>
);
}
