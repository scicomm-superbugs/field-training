import { useState, useEffect, useMemo } from 'react';
import { db, firestore, getCollectionName, useLiveCollection } from './db';
import { collection, getDocs } from 'firebase/firestore';
import { Settings, Save, Search, UserCheck } from 'lucide-react';
import { FT_DEFAULT_REQUIRED_HOURS, FT_DEPARTMENTS } from './ftConstants';

export default function FTAdminSettings() {
  const [requiredHours, setRequiredHours] = useState(FT_DEFAULT_REQUIRED_HOURS);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [deptOverrides, setDeptOverrides] = useState({});
  const [allowSelfRegister, setAllowSelfRegister] = useState(true);

  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');

  const resetRequests = useLiveCollection('ft_reset_requests');

  useEffect(() => {
    (async () => {
      try {
        const settings = await db.ft_settings.get();
        if (settings) {
          setRequiredHours(settings.requiredCreditHours || FT_DEFAULT_REQUIRED_HOURS);
          setDeptOverrides(settings.departmentOverrides || {});
          setAllowSelfRegister(settings.allowSelfRegister !== false);
        }

        const col = getCollectionName('scientists');
        const snap = await getDocs(collection(firestore, col));
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setUsers(list);
      } catch (err) {
        console.error("Failed to load settings/users:", err);
      }
      setLoaded(true);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await db.ft_settings.set({
        requiredCreditHours: parseInt(requiredHours) || FT_DEFAULT_REQUIRED_HOURS,
        departmentOverrides: deptOverrides,
        allowSelfRegister: allowSelfRegister,
        updatedAt: new Date().toISOString(),
      });
      setToast({ type: 'success', msg: 'Settings saved successfully!' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to save: ' + err.message });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpgradeRole = async (userId, newRole) => {
    try {
      await db.scientists.update(userId, { role: newRole });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      setToast({ type: 'success', msg: `User role successfully updated to ${newRole === 'trainer' ? 'Supervisor' : newRole}!` });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to update role: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleApproveSupervisor = async (userId) => {
    try {
      await db.scientists.update(userId, { accountStatus: 'active' });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, accountStatus: 'active' } : u));
      setToast({ type: 'success', msg: 'Supervisor approved successfully!' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to approve supervisor: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleRejectSupervisor = async (userId) => {
    try {
      await db.scientists.delete(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      setToast({ type: 'success', msg: 'Supervisor registration rejected and deleted.' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to reject supervisor: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleApproveReset = async (reqId) => {
    try {
      await db.ft_reset_requests.update(reqId, {
        status: 'approved',
        approvedAt: new Date().toISOString()
      });
      setToast({ type: 'success', msg: 'Password reset request approved! The user can now reset their password.' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to approve request: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleRejectReset = async (reqId) => {
    try {
      await db.ft_reset_requests.delete(reqId);
      setToast({ type: 'success', msg: 'Password reset request rejected and deleted.' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to reject request: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return [];
    return users.filter(u => 
      u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.username?.toLowerCase().includes(userSearch.toLowerCase())
    );
  }, [users, userSearch]);

  if (!loaded) {
    return (
      <div className="ft-animate-in">
        <div className="ft-skeleton" style={{ width: '200px', height: '28px', marginBottom: '2rem' }} />
        <div className="ft-skeleton" style={{ width: '100%', height: '300px', borderRadius: 'var(--ft-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="ft-animate-in">
      <div className="ft-page-header">
        <h1 className="ft-page-title">⚙️ Settings</h1>
        <p className="ft-page-subtitle">Configure global field training requirements. Admin access only.</p>
      </div>

      {/* Required Credit Hours */}
      <div className="ft-card" style={{ maxWidth: '600px', marginBottom: '1.5rem' }}>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Settings size={20} style={{ color: 'var(--ft-primary)' }} />
          Required Credit Hours
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', marginBottom: '1.25rem' }}>
          Set the total credit hours students must achieve to complete their field training.
        </p>

        <div className="ft-input-group">
          <label className="ft-label">Total Required Hours (Global)</label>
          <input
            className="ft-input"
            type="number"
            min="1"
            value={requiredHours}
            onChange={e => setRequiredHours(e.target.value)}
            style={{ maxWidth: '200px' }}
          />
        </div>

        {/* Per-Department Overrides */}
        <div style={{ marginTop: '1.5rem' }}>
          <label className="ft-label" style={{ marginBottom: '0.75rem' }}>
            Department-Specific Overrides (optional)
          </label>
          <p style={{ fontSize: '0.8rem', color: 'var(--ft-text-muted)', marginBottom: '1rem' }}>
            Leave blank to use the global value. Students in that department will need to meet the department-specific hours instead.
          </p>
          {FT_DEPARTMENTS.map(dept => (
            <div key={dept} style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, minWidth: '170px' }}>{dept}</span>
              <input
                className="ft-input"
                type="number"
                min="0"
                placeholder={`${requiredHours} (global)`}
                value={deptOverrides[dept] || ''}
                onChange={e => setDeptOverrides(prev => ({ ...prev, [dept]: e.target.value ? parseInt(e.target.value) : '' }))}
                style={{ maxWidth: '160px' }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)' }}>hours</span>
            </div>
          ))}
        </div>
      </div>

      {/* Registration Settings */}
      <div className="ft-card" style={{ maxWidth: '600px', marginBottom: '1.5rem' }}>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          📝 Student Registration Options
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', marginBottom: '1.25rem' }}>
          Choose whether students can enroll themselves or if registrations must be uploaded manually by staff.
        </p>

        <div className="ft-input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <input
            type="checkbox"
            id="allowSelfRegister-checkbox"
            checked={allowSelfRegister}
            onChange={e => setAllowSelfRegister(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <label htmlFor="allowSelfRegister-checkbox" className="ft-label" style={{ margin: 0, cursor: 'pointer', fontWeight: 600 }}>
            Allow students to self-register for training places
          </label>
        </div>
      </div>

      {/* Pending Supervisor Approvals */}
      {(() => {
        const pendingSupervisors = users.filter(u => u.role === 'trainer' && u.accountStatus === 'pending');
        if (pendingSupervisors.length === 0) return null;
        return (
          <div className="ft-card" style={{ maxWidth: '600px', marginBottom: '2rem', border: '1.5px solid var(--ft-primary)' }}>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--ft-primary)' }}>
              🧑‍🏫 Pending Supervisor Approvals ({pendingSupervisors.length})
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', marginBottom: '1.25rem' }}>
              These users registered as Supervisors/Instructors. They will not be able to log in until you approve them.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pendingSupervisors.map(u => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1.5px solid var(--ft-border-light)', borderRadius: 'var(--ft-radius)', background: 'var(--ft-bg-card)', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{u.name} <span style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>({u.title})</span></div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', marginTop: '0.15rem' }}>
                      Email: {u.email} · Department: {u.department}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={() => handleApproveSupervisor(u.id)}>
                      Approve
                    </button>
                    <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.15)' }} onClick={() => handleRejectSupervisor(u.id)}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Role Management Card */}
      <div className="ft-card" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          👨‍🏫 Manage Supervisors & Roles
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', marginBottom: '1.25rem' }}>
          Upgrade students, faculty, or other accounts to be Field Trainers / Supervisors.
        </p>

        <div className="ft-input-group" style={{ position: 'relative' }}>
          <label className="ft-label">Search User by Name, Email, or Username</label>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
            <input
              className="ft-input"
              style={{ paddingLeft: '2.5rem' }}
              type="text"
              placeholder="Type student name or email..."
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
            />
          </div>
        </div>

        {userSearch.trim() && (
          <div style={{ background: 'var(--ft-bg-input)', border: '1px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', maxHeight: '240px', overflowY: 'auto', padding: '0.5rem' }}>
            {filteredUsers.length === 0 ? (
              <div style={{ padding: '1rem', fontSize: '0.8rem', color: 'var(--ft-text-muted)', textAlign: 'center' }}>No users found matching your search.</div>
            ) : (
              filteredUsers.map(u => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0.5rem', borderBottom: '1px solid var(--ft-border-light)', fontSize: '0.88rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {u.name || u.username}
                      {u.universityId && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--ft-text-muted)', background: 'var(--ft-border-light)', padding: '0.05rem 0.25rem', borderRadius: '4px' }}>
                          ID: {u.universityId}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', marginTop: '0.15rem' }}>
                      Email: {u.email || '—'} · Current Role: <span style={{ fontWeight: 700, color: 'var(--ft-primary)', textTransform: 'capitalize' }}>{u.role || 'student'}</span>
                    </div>
                  </div>
                  {u.role !== 'trainer' && u.role !== 'admin' && u.role !== 'master' ? (
                    <button
                      className="ft-btn ft-btn-primary ft-btn-sm"
                      onClick={() => handleUpgradeRole(u.id, 'trainer')}
                    >
                      Make Supervisor
                    </button>
                  ) : u.role === 'trainer' ? (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="ft-btn ft-btn-primary ft-btn-sm"
                        onClick={() => handleUpgradeRole(u.id, 'admin')}
                      >
                        Make Admin
                      </button>
                      <button
                        className="ft-btn ft-btn-secondary ft-btn-sm"
                        style={{ color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                        onClick={() => handleUpgradeRole(u.id, 'student')}
                      >
                        Revoke Supervisor
                      </button>
                    </div>
                  ) : u.role === 'admin' ? (
                    <button
                      className="ft-btn ft-btn-secondary ft-btn-sm"
                      style={{ color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                      onClick={() => handleUpgradeRole(u.id, 'trainer')}
                    >
                      Demote to Supervisor
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', fontWeight: 600 }}>System Creator</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Password Reset Requests Card */}
      <div className="ft-card" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🔑 Password Reset Requests
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', marginBottom: '1.25rem' }}>
          Approve requested password resets. Once approved, the user can reset their password on the login screen using their username, email, and ID/title.
        </p>

        {!resetRequests || resetRequests.length === 0 ? (
          <div style={{ padding: '1.5rem', background: 'var(--ft-bg-input)', border: '1px solid var(--ft-border-light)', borderRadius: 'var(--ft-radius)', textAlign: 'center', fontSize: '0.82rem', color: 'var(--ft-text-muted)' }}>
            No password reset requests found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {resetRequests.map(req => (
              <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1.5px solid var(--ft-border-light)', borderRadius: 'var(--ft-radius)', background: 'var(--ft-bg-card)', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    Username: <span style={{ color: 'var(--ft-primary)' }}>{req.username}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', marginTop: '0.2rem' }}>
                    Email: {req.email}
                  </div>
                  <div style={{ fontSize: '0.75rem', marginTop: '0.35rem' }}>
                    Status: {' '}
                    <span className={`ft-badge ${req.status === 'approved' ? 'ft-badge-success' : 'ft-badge-warning'}`} style={{ textTransform: 'capitalize', fontSize: '0.72rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                      {req.status}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {req.status === 'pending' && (
                    <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={() => handleApproveReset(req.id)}>
                      Approve
                    </button>
                  )}
                  <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.15)' }} onClick={() => handleRejectReset(req.id)}>
                    {req.status === 'approved' ? 'Remove' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Button */}
      <button className="ft-btn ft-btn-primary ft-btn-lg" onClick={handleSave} disabled={saving} style={{ marginRight: '1rem' }}>
        <Save size={18} />
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      {/* Toast */}
      {toast && (
        <div className={`ft-toast ft-toast-${toast.type}`}>
          <span>{toast.type === 'success' ? '✅' : '❌'}</span>
          <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
