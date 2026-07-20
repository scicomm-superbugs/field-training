import { useState, useEffect, useMemo, Fragment } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, firestore, getCollectionName } from './db';
import { collection, getDocs } from 'firebase/firestore';
import { Search, Download, X } from 'lucide-react';
import bcrypt from 'bcryptjs';
import { FT_DEPARTMENTS, FT_REG_STATUS_ICONS, FT_REG_STATUS_LABELS, FT_DEFAULT_REQUIRED_HOURS } from './ftConstants';
import { getUserConflicts, getWaveDates } from './ftConflictUtils';

export default function FTAdminStudents() {
  const { registrations, places, settings, meDoc, userRole } = useOutletContext();

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [hasSwipedTable, setHasSwipedTable] = useState(false);

  const [editingStudent, setEditingStudent] = useState(null);
  const [confirmDeleteStudentId, setConfirmDeleteStudentId] = useState(null);
  const [toast, setToast] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    username: '',
    email: '',
    universityId: '',
    title: '',
    role: 'student',
    department: '',
    password: ''
  });

  const settingsDoc = settings?.find(s => s.id === 'global');
  const requiredHours = settingsDoc?.requiredCreditHours || FT_DEFAULT_REQUIRED_HOURS;

  // Load all students
  useEffect(() => {
    (async () => {
      try {
        const col = getCollectionName('scientists');
        const snap = await getDocs(collection(firestore, col));
        const allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const studentList = allUsers.filter(u => u.role === 'student' || u.role === 'user' || !u.role);
        setStudents(studentList);
      } catch (err) {
        console.error('Failed to load students:', err);
      }
      setLoading(false);
    })();
  }, []);

  // Compute student data with progress
  const enrichedStudents = useMemo(() => {
    if (!registrations || !places) return students.map(s => ({ ...s, registered: 0, completed: 0, regs: [], isInProgress: false }));

    const now = new Date();

    return students.map(s => {
      const myRegs = registrations.filter(r => r.studentId === s.id);
      let registered = 0;
      let completed = 0;
      let hasOngoingWave = false;

      myRegs.forEach(reg => {
        const place = places.find(p => p.id === reg.placeId);
        const hours = place?.creditHours || reg.creditHours || 0;
        registered += hours;
        if (reg.status === 'completed') completed += hours;
        
        if (place && reg.status !== 'failed' && reg.status !== 'rejected') {
          let wave = null;
          if (place.hasPrograms && reg.programId) {
            const prog = place.programs?.find(p => p.id === reg.programId);
            wave = prog?.waves?.find(w => w.id === reg.waveId);
          } else {
            wave = place.waves?.find(w => w.id === reg.waveId);
          }
          const dates = getWaveDates(wave);
          if (dates && now >= dates.start && now <= dates.end) {
            hasOngoingWave = true;
          }
        }
      });

      const deptRequired = settingsDoc?.departmentOverrides?.[s.department] || requiredHours;
      const pct = deptRequired > 0 ? Math.min(100, Math.round((completed / deptRequired) * 100)) : 0;
      
      const conflicts = getUserConflicts(s.id, registrations, places);
      
      const isInProgress = (pct > 0 && pct < 100) || hasOngoingWave;

      return { ...s, registered, completed, required: deptRequired, pct, regs: myRegs, hasConflicts: conflicts.length > 0, isInProgress };
    });
  }, [students, registrations, places, settingsDoc, requiredHours]);

  // Filter
  const filtered = useMemo(() => {
    return enrichedStudents.filter(s => {
      const matchSearch = !search ||
        s.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.email?.toLowerCase().includes(search.toLowerCase()) ||
        s.username?.toLowerCase().includes(search.toLowerCase()) ||
        s.universityId?.toLowerCase().includes(search.toLowerCase());
      const matchDept = deptFilter === 'All' || s.department === deptFilter;
      const matchStatus = statusFilter === 'All' ||
        (statusFilter === 'completed' && s.pct >= 100) ||
        (statusFilter === 'in-progress' && s.isInProgress && s.pct < 100) ||
        (statusFilter === 'not-started' && s.pct === 0 && !s.isInProgress) ||
        (statusFilter === 'conflicted' && s.hasConflicts);
      return matchSearch && matchDept && matchStatus;
    });
  }, [enrichedStudents, search, deptFilter, statusFilter]);

  // Export CSV
  const exportCSV = () => {
    const headers = ['Name', 'University ID', 'Email', 'Phone', 'Department', 'Registered Hours', 'Completed Hours', 'Required Hours', 'Progress %'];
    const rows = filtered.map(s => [s.name, s.universityId || '—', s.email || '', s.phone || '', s.department || '', s.registered, s.completed, s.required, s.pct]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `field_training_students_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openEditModal = (student) => {
    setEditingStudent(student);
    setEditForm({
      name: student.name || '',
      username: student.username || '',
      email: student.email || '',
      universityId: student.universityId || '',
      title: student.title || '',
      role: student.role || 'student',
      department: student.department || '',
      password: ''
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editForm.email || !editForm.email.toLowerCase().endsWith('@aiu.edu.eg')) {
      alert('Only @aiu.edu.eg university email addresses are allowed.');
      return;
    }
    try {
      const isSupervisor = editForm.role !== 'student' && editForm.role !== 'user';
      const updates = {
        name: editForm.name.trim(),
        username: editForm.username.trim(),
        email: editForm.email.trim(),
        universityId: isSupervisor ? '' : editForm.universityId.trim(),
        title: isSupervisor ? editForm.title.trim() : '',
        role: editForm.role,
        department: editForm.department,
        updatedAt: new Date().toISOString()
      };

      if (editForm.password.trim()) {
        if (editForm.password.length < 6) {
          alert('Password must be at least 6 characters');
          return;
        }
        const salt = await bcrypt.genSalt(4);
        updates.passwordHash = await bcrypt.hash(editForm.password, salt);
      }

      await db.scientists.update(editingStudent.id, updates);
      
      // Auto-sync registration records with updated profile info
      if (registrations) {
        const studentRegs = registrations.filter(r => r.studentId === editingStudent.id);
        for (const reg of studentRegs) {
          const regUpdates = {};
          if (updates.name && reg.studentName !== updates.name) regUpdates.studentName = updates.name;
          if (updates.universityId !== undefined && reg.studentUniversityId !== updates.universityId) regUpdates.studentUniversityId = updates.universityId;
          if (updates.email && reg.studentEmail !== updates.email) regUpdates.studentEmail = updates.email;
          if (updates.department && reg.studentDepartment !== updates.department) regUpdates.studentDepartment = updates.department;
          if (Object.keys(regUpdates).length > 0) {
            try { await db.ft_registrations.update(reg.id, regUpdates); } catch (e) { console.error('Failed to sync reg:', e); }
          }
        }
      }

      // Update local state list
      setStudents(prev => prev.map(u => u.id === editingStudent.id ? { ...u, ...updates } : u));
      setEditingStudent(null);
      alert('Account details updated successfully! Registration records have been synced.');
    } catch (err) {
      alert('Failed to update: ' + err.message);
    }
  };

  // Stats
  const totalStudents = enrichedStudents.length;
  const completedStudents = enrichedStudents.filter(s => s.pct >= 100).length;
  const inProgressStudents = enrichedStudents.filter(s => s.isInProgress && s.pct < 100).length;
  const notStartedStudents = enrichedStudents.filter(s => s.pct === 0 && !s.isInProgress).length;
  const conflictedStudents = enrichedStudents.filter(s => s.hasConflicts).length;

  return (
    <>
      <div className="ft-animate-in">
      <div className="ft-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="ft-page-title">Students Overview</h1>
          <p className="ft-page-subtitle">Monitor all students' field training progress.</p>
        </div>
        <button className="ft-btn ft-btn-secondary" onClick={exportCSV}>
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Stats */}
      <div className="ft-stats-grid">
        <div className={`ft-stat-card ${statusFilter === 'All' ? 'active-filter' : ''}`} style={{ cursor: 'pointer', outline: statusFilter === 'All' ? '2px solid var(--ft-primary)' : 'none' }} onClick={() => setStatusFilter('All')}>
          <div className="ft-stat-icon" style={{ background: 'var(--ft-primary-bg)' }}>👥</div>
          <div>
            <div className="ft-stat-value">{totalStudents}</div>
            <div className="ft-stat-label">Total Students</div>
          </div>
        </div>
        <div className={`ft-stat-card ${statusFilter === 'completed' ? 'active-filter' : ''}`} style={{ cursor: 'pointer', outline: statusFilter === 'completed' ? '2px solid var(--ft-success)' : 'none' }} onClick={() => setStatusFilter('completed')}>
          <div className="ft-stat-icon" style={{ background: 'var(--ft-success-bg)' }}>✅</div>
          <div>
            <div className="ft-stat-value" style={{ color: 'var(--ft-success)' }}>{completedStudents}</div>
            <div className="ft-stat-label">Completed</div>
          </div>
        </div>
        <div className={`ft-stat-card ${statusFilter === 'in-progress' ? 'active-filter' : ''}`} style={{ cursor: 'pointer', outline: statusFilter === 'in-progress' ? '2px solid var(--ft-info)' : 'none' }} onClick={() => setStatusFilter('in-progress')}>
          <div className="ft-stat-icon" style={{ background: 'var(--ft-info-bg)' }}>🔵</div>
          <div>
            <div className="ft-stat-value" style={{ color: 'var(--ft-info)' }}>{inProgressStudents}</div>
            <div className="ft-stat-label">In Progress</div>
          </div>
        </div>
        <div className={`ft-stat-card ${statusFilter === 'not-started' ? 'active-filter' : ''}`} style={{ cursor: 'pointer', outline: statusFilter === 'not-started' ? '2px solid var(--ft-warning)' : 'none' }} onClick={() => setStatusFilter('not-started')}>
          <div className="ft-stat-icon" style={{ background: 'var(--ft-warning-bg)' }}>🟡</div>
          <div>
            <div className="ft-stat-value" style={{ color: 'var(--ft-warning)' }}>{notStartedStudents}</div>
            <div className="ft-stat-label">Not Started</div>
          </div>
        </div>
        <div className={`ft-stat-card ${statusFilter === 'conflicted' ? 'active-filter' : ''}`} style={{ cursor: 'pointer', outline: statusFilter === 'conflicted' ? '2px solid var(--ft-danger)' : 'none' }} onClick={() => setStatusFilter('conflicted')}>
          <div className="ft-stat-icon" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>⚠️</div>
          <div>
            <div className="ft-stat-value" style={{ color: 'var(--ft-danger)' }}>{conflictedStudents}</div>
            <div className="ft-stat-label">Conflicted</div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="ft-search-bar">
        <div className="ft-search-input-wrapper">
          <Search size={18} />
          <input type="text" placeholder="Search students by name or email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="ft-filter-chips">
          <button className={`ft-chip ${deptFilter === 'All' ? 'active' : ''}`} onClick={() => setDeptFilter('All')}>All Depts</button>
          {FT_DEPARTMENTS.map(d => <button key={d} className={`ft-chip ${deptFilter === d ? 'active' : ''}`} onClick={() => setDeptFilter(d)}>{d}</button>)}
        </div>
        <div className="ft-filter-chips">
          {['All', 'completed', 'in-progress', 'not-started', 'conflicted'].map(s => (
            <button key={s} className={`ft-chip ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>
              {s === 'All' ? 'All Status' : s === 'completed' ? '✅ Completed' : s === 'in-progress' ? '🔵 In Progress' : s === 'not-started' ? '🟡 Not Started' : '⚠️ Conflicted'}
            </button>
          ))}
        </div>
      </div>

      {/* Students Table */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="ft-skeleton" style={{ height: '56px', borderRadius: 'var(--ft-radius-sm)' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ft-empty">
          <div className="ft-empty-icon">👤</div>
          <div className="ft-empty-title">No Students Found</div>
          <div className="ft-empty-text">Adjust your search or filter criteria.</div>
        </div>
      ) : (
        <div className="ft-table-wrapper" onScroll={(e) => { if (e.target.scrollLeft > 10) setHasSwipedTable(true); }}>
          <table className="ft-table" style={{ tableLayout: 'fixed', width: '100%', minWidth: '890px' }}>
            <thead>
              <tr>
                <th style={{ width: '110px' }}>University ID</th>
                <th style={{ width: '220px' }}>Student</th>
                <th style={{ width: '150px' }}>Department</th>
                <th style={{ width: '95px' }}>Registered</th>
                <th style={{ width: '95px' }}>Completed</th>
                <th style={{ width: '125px' }}>Progress</th>
                <th style={{ width: '95px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <Fragment key={s.id}>
                  <tr onClick={() => setExpandedStudent(expandedStudent === s.id ? null : s.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ width: '110px', position: 'relative' }}>
                      {!hasSwipedTable && <div className="ft-swipe-indicator" style={{ left: 'calc(100vw - 140px)', right: 'auto', zIndex: 1, pointerEvents: 'none' }}>👈 Swipe</div>}
                      <span style={{ 
                        fontFamily: "'Outfit', sans-serif", 
                        fontWeight: 700, 
                        color: 'var(--ft-primary)', 
                        background: 'var(--ft-primary-bg)', 
                        padding: '0.2rem 0.5rem', 
                        borderRadius: 'var(--ft-radius-sm)', 
                        fontSize: '0.78rem',
                        border: '1px solid rgba(190, 18, 60, 0.1)'
                      }}>
                        {s.universityId || '—'}
                      </span>
                    </td>
                    <td style={{ width: '220px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: 'var(--ft-radius-full)', background: 'var(--ft-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, color: 'var(--ft-primary)', flexShrink: 0, overflow: 'hidden' }}>
                          {s.avatar ? <img src={s.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (s.name || '?')[0].toUpperCase()}
                        </div>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--ft-text)' }}>{s.name || s.username}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--ft-text-muted)' }}>{s.email || ''}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ width: '150px' }}><span style={{ fontSize: '0.82rem', color: 'var(--ft-text-secondary)' }}>{s.department || '—'}</span></td>
                    <td style={{ width: '95px' }}><span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600 }}>{s.registered}h</span></td>
                    <td style={{ width: '95px' }}><span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--ft-success)' }}>{s.completed}h</span></td>
                    <td style={{ width: '125px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div className="ft-progress-bar" style={{ width: '70px', height: '6px' }}>
                          <div className="ft-progress-bar-fill" style={{
                            width: `${s.pct}%`,
                            background: s.pct >= 100 ? 'linear-gradient(90deg, var(--ft-success), #4ade80)' : undefined
                          }} />
                        </div>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: s.pct >= 100 ? 'var(--ft-success)' : 'var(--ft-text-muted)' }}>{s.pct}%</span>
                      </div>
                    </td>
                    <td style={{ width: '95px' }}>
                      {s.pct >= 100 ? (
                        <span className="ft-badge ft-badge-completed">Done</span>
                      ) : s.isInProgress ? (
                        <span className="ft-badge ft-badge-active">Active</span>
                      ) : (
                        <span className="ft-badge ft-badge-pending">Not Started</span>
                      )}
                    </td>
                  </tr>
                  {expandedStudent === s.id && (
                    <tr style={{ background: 'var(--ft-bg-input)' }}>
                      <td colSpan="7" style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid var(--ft-border-light)', borderBottom: '1px solid var(--ft-border-light)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <h4 style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ft-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                              📁 Active Registrations ({s.regs?.length || 0})
                            </h4>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              {(userRole === 'master' || userRole === 'admin' || userRole === 'trainer' || userRole === 'faculty') && (
                                <button 
                                  className="ft-btn ft-btn-secondary ft-btn-sm" 
                                  onClick={(e) => { e.stopPropagation(); openEditModal(s); }}
                                  style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}
                                >
                                  ✏️ Edit Details
                                </button>
                              )}
                              {(userRole === 'master' || userRole === 'admin') && (
                                <button 
                                  className="ft-btn ft-btn-secondary ft-btn-sm" 
                                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteStudentId(s.id); }}
                                  style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.15)' }}
                                >
                                  🗑️ Delete Account
                                </button>
                              )}
                            </div>
                          </div>
                          {s.regs && s.regs.length > 0 ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                              {s.regs.map(reg => (
                                <div key={reg.id} style={{ background: 'var(--ft-bg-card)', padding: '0.75rem 1rem', borderRadius: 'var(--ft-radius-sm)', border: '1.5px solid var(--ft-border)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{reg.placeName}</span>
                                    <span className={`ft-badge ft-badge-${reg.status}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>
                                      {FT_REG_STATUS_ICONS[reg.status]} {FT_REG_STATUS_LABELS[reg.status]}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>Hours: {reg.creditHours}h</span>
                                    {reg.waveName && (
                                      <span style={{ color: 'var(--ft-primary)', fontWeight: 600, background: 'var(--ft-primary-bg)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.72rem' }}>🌊 {reg.waveName}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', fontStyle: 'italic' }}>
                              No registrations found for this student.
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </div>

      {/* Edit Student Modal */}
      {editingStudent && (
        <div className="ft-modal-overlay">
          <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="ft-modal-header">
              <h3 className="ft-modal-title">✏️ Edit Student Account</h3>
              <button className="ft-btn ft-btn-ghost ft-btn-icon" onClick={() => setEditingStudent(null)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="ft-modal-body">
                <div className="ft-input-group">
                  <label className="ft-label">Full Name *</label>
                  <input 
                    type="text" 
                    className="ft-input" 
                    required 
                    value={editForm.name} 
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })} 
                  />
                </div>
                <div className="ft-input-group">
                  <label className="ft-label">Username *</label>
                  <input 
                    type="text" 
                    className="ft-input" 
                    required 
                    value={editForm.username} 
                    onChange={e => setEditForm({ ...editForm, username: e.target.value })} 
                  />
                </div>
                <div className="ft-input-group">
                  <label className="ft-label">University Email *</label>
                  <input 
                    type="email" 
                    className="ft-input" 
                    required 
                    value={editForm.email} 
                    onChange={e => setEditForm({ ...editForm, email: e.target.value })} 
                  />
                </div>
                {(userRole === 'admin' || userRole === 'master') && (
                  <div className="ft-input-group">
                    <label className="ft-label">Account Role *</label>
                    <select 
                      className="ft-select" 
                      required 
                      value={editForm.role} 
                      onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                    >
                      <option value="student">Student</option>
                      <option value="trainer">Supervisor</option>
                      <option value="admin">Administrator</option>
                      {userRole === 'master' && <option value="master">Master Administrator</option>}
                    </select>
                  </div>
                )}

                {editForm.role === 'student' || editForm.role === 'user' ? (
                  <div className="ft-input-group">
                    <label className="ft-label">University ID Number *</label>
                    <input 
                      type="text" 
                      className="ft-input" 
                      required 
                      value={editForm.universityId} 
                      onChange={e => setEditForm({ ...editForm, universityId: e.target.value })} 
                    />
                  </div>
                ) : (
                  <div className="ft-input-group">
                    <label className="ft-label">Supervisor Title *</label>
                    <input 
                      type="text" 
                      className="ft-input" 
                      required 
                      value={editForm.title} 
                      onChange={e => setEditForm({ ...editForm, title: e.target.value })} 
                    />
                  </div>
                )}
                <div className="ft-input-group">
                  <label className="ft-label">Department *</label>
                  <select 
                    className="ft-select" 
                    required 
                    value={editForm.department} 
                    onChange={e => setEditForm({ ...editForm, department: e.target.value })}
                  >
                    <option value="Biotechnology">Biotechnology</option>
                    <option value="Industrial Chemistry">Industrial Chemistry</option>
                    <option value="Sustainable Energy">Sustainable Energy</option>
                  </select>
                </div>
                <div className="ft-input-group" style={{ marginBottom: 0 }}>
                  <label className="ft-label">Reset Password (Leave blank to keep current)</label>
                  <input 
                    type="password" 
                    className="ft-input" 
                    placeholder="Enter new password" 
                    value={editForm.password} 
                    onChange={e => setEditForm({ ...editForm, password: e.target.value })} 
                  />
                </div>
              </div>
              <div className="ft-modal-footer">
                <button type="button" className="ft-btn ft-btn-secondary" style={{ flex: 1 }} onClick={() => setEditingStudent(null)}>
                  Cancel
                </button>
                <button type="submit" className="ft-btn ft-btn-primary" style={{ flex: 1 }}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Student Confirmation Modal */}
      {confirmDeleteStudentId && (
        <div className="ft-modal-overlay">
          <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="ft-modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>⚠️</div>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Delete Student Account?</h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--ft-text-secondary)', marginBottom: '1.5rem' }}>
                Are you sure you want to permanently delete this student account and all of their active registrations? This action cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="ft-btn ft-btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmDeleteStudentId(null)}>Cancel</button>
                <button className="ft-btn ft-btn-danger" style={{ flex: 1 }} onClick={async () => {
                  const studentId = confirmDeleteStudentId;
                  setConfirmDeleteStudentId(null);
                  try {
                    // Delete registrations
                    const studentRegs = registrations?.filter(r => r.studentId === studentId) || [];
                    for (const reg of studentRegs) {
                      await db.ft_registrations.delete(reg.id);
                    }
                    // Delete student scientist record
                    await db.scientists.delete(studentId);
                    
                    // Update local students list state
                    setStudents(prev => prev.filter(st => st.id !== studentId));
                    setExpandedStudent(null);
                    
                    setToast({ type: 'success', msg: 'Student account deleted successfully!' });
                  } catch (err) {
                    setToast({ type: 'error', msg: 'Failed to delete student: ' + err.message });
                  }
                  setTimeout(() => setToast(null), 3000);
                }}>Delete</button>
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
