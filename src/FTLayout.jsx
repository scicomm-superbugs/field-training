import { useState, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { db, firestore, getCollectionName, useLiveCollection, getFirebaseAuth } from './db';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { MapPin, BookOpen, Users, Settings, ClipboardCheck, LayoutDashboard, LogOut, Moon, Sun, Menu, X, ChevronDown, GraduationCap } from 'lucide-react';
import { FT_FACULTY, FT_ROLE_LABELS, FT_ROLE_COLORS, isFacultyRole, isTrainerRole, isStudentRole, FT_DEFAULT_REQUIRED_HOURS } from './ftConstants';
import bcrypt from 'bcryptjs';
import './fieldtraining.css';

export default function FTLayout() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [dark, setDark] = useState(() => localStorage.getItem('ft-theme') === 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [meDoc, setMeDoc] = useState(null);

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    username: '',
    email: '',
    universityId: '',
    title: '',
    role: '',
    password: '',
    confirmPassword: ''
  });
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Live collections
  const registrations = useLiveCollection('ft_registrations');
  const settings = useLiveCollection('ft_settings');
  const places = useLiveCollection('ft_places');
  const resetRequests = useLiveCollection('ft_reset_requests');

  // Load full user doc
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const s = await db.scientists.get(user.id);
      if (s) setMeDoc(s);
    })();
  }, [user?.id]);

  // Auto-link pending CSV registrations on load
  useEffect(() => {
    if (!user?.id || !meDoc) return;

    (async () => {
      try {
        const isStudent = meDoc.role === 'student' || meDoc.role === 'user' || !meDoc.role;
        if (!isStudent) return;

        const regCol = getCollectionName('ft_registrations');
        let linkedCount = 0;

        if (meDoc.universityId) {
          const q1 = query(
            collection(firestore, regCol),
            where('studentUniversityId', '==', meDoc.universityId)
          );
          const snap1 = await getDocs(q1);

          for (const docSnap of snap1.docs) {
            const reg = docSnap.data();
            if (!reg.studentId) {
              await db.ft_registrations.update(docSnap.id, {
                studentId: user.id,
                studentName: meDoc.name || reg.studentName || '',
                studentEmail: meDoc.email || reg.studentEmail || '',
                studentDepartment: meDoc.department || reg.studentDepartment || ''
              });
              linkedCount++;
            }
          }
        }

        if (meDoc.email) {
          const q2 = query(
            collection(firestore, regCol),
            where('studentEmail', '==', meDoc.email)
          );
          const snap2 = await getDocs(q2);
          for (const docSnap of snap2.docs) {
            const reg = docSnap.data();
            if (!reg.studentId) {
              await db.ft_registrations.update(docSnap.id, {
                studentId: user.id,
                studentName: meDoc.name || reg.studentName || '',
                studentEmail: meDoc.email || reg.studentEmail || '',
                studentDepartment: meDoc.department || reg.studentDepartment || ''
              });
              linkedCount++;
            }
          }
        }

        if (linkedCount > 0) {
          console.log(`Auto-linked ${linkedCount} pre-assigned registrations for student ${meDoc.name}`);
        }
      } catch (err) {
        console.error("Failed to auto-link registrations:", err);
      }
    })();
  }, [user?.id, meDoc]);

  // Auto-approve pending registrations past their deadline
  useEffect(() => {
    if (places && registrations) {
      const now = new Date();
      places.forEach(async (place) => {
        if (place.registrationDeadline) {
          const deadline = new Date(place.registrationDeadline);
          if (deadline < now) {
            // Find pending registrations for this place
            const pendingRegsForPlace = registrations.filter(r => r.placeId === place.id && r.status === 'pending');
            for (const reg of pendingRegsForPlace) {
              try {
                await db.ft_registrations.update(reg.id, {
                  status: 'active',
                  approvedAt: now.toISOString(),
                  autoApproved: true
                });
                console.log(`Auto-approved registration ${reg.id} for student ${reg.studentName} (deadline passed)`);
              } catch (e) {
                console.error("Failed to auto-approve registration on deadline:", e);
              }
            }
          }
        }
      });
    }
  }, [places, registrations]);

  useEffect(() => {
    if (meDoc) {
      setProfileForm({
        name: meDoc.name || '',
        username: meDoc.username || '',
        email: meDoc.email || '',
        universityId: meDoc.universityId || '',
        title: meDoc.title || '',
        role: meDoc.role || '',
        password: '',
        confirmPassword: ''
      });
    }
  }, [meDoc, showProfileModal]);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    if (!profileForm.email || !profileForm.email.toLowerCase().endsWith('@aiu.edu.eg')) {
      setProfileError('Only @aiu.edu.eg university email addresses are allowed.');
      return;
    }

    if (profileForm.password.trim()) {
      if (profileForm.password !== profileForm.confirmPassword) {
        setProfileError('Passwords do not match');
        return;
      }
      if (profileForm.password.length < 6) {
        setProfileError('Password must be at least 6 characters');
        return;
      }
    }

    setSavingProfile(true);
    try {
      const updates = {
        name: profileForm.name.trim(),
        username: profileForm.username.trim(),
        email: profileForm.email.trim(),
        universityId: isStudentRole(profileForm.role) ? profileForm.universityId.trim() : '',
        title: (profileForm.role !== 'student' && profileForm.role !== 'user') ? profileForm.title.trim() : '',
        role: profileForm.role,
        updatedAt: new Date().toISOString()
      };

      if (profileForm.password.trim()) {
        const salt = await bcrypt.genSalt(4);
        updates.passwordHash = await bcrypt.hash(profileForm.password, salt);
      }

      await db.scientists.update(user.id, updates);
      
      // Update local state meDoc & auth user details
      setMeDoc(prev => ({ ...prev, ...updates }));
      setUser(prev => ({
        ...prev,
        username: updates.username,
        name: updates.name,
        role: updates.role
      }));

      setProfileSuccess('Profile updated successfully!');
      setTimeout(() => {
        setShowProfileModal(false);
        setProfileSuccess('');
      }, 1500);
    } catch (err) {
      setProfileError('Failed to update profile: ' + err.message);
    }
    setSavingProfile(false);
  };

  const handleLinkGoogle = async () => {
    setProfileError('');
    setProfileSuccess('');
    try {
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      const result = await signInWithPopup(auth, provider);
      const googleUser = result.user;
      if (!googleUser || !googleUser.email) {
        throw new Error('Could not retrieve Google account details.');
      }

      const googleEmail = googleUser.email;

      const existingLink = await db.scientists.where('googleEmail').equals(googleEmail).first();
      if (existingLink && existingLink.id !== user.id) {
        setProfileError(`This Google account (${googleEmail}) is already linked to another user.`);
        return;
      }

      const existingEmail = await db.scientists.where('email').equals(googleEmail).first();
      if (existingEmail && existingEmail.id !== user.id) {
        setProfileError(`This Google account email (${googleEmail}) is already registered as another user's primary email.`);
        return;
      }

      await db.scientists.update(user.id, { googleEmail });
      setMeDoc(prev => ({ ...prev, googleEmail }));
      setProfileSuccess(`Successfully linked Google account: ${googleEmail}`);
      setTimeout(() => {
        setProfileSuccess('');
      }, 3000);
    } catch (err) {
      setProfileError('Failed to link Google account: ' + err.message);
    }
  };

  // Dark mode toggle
  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('ft-dark');
      localStorage.setItem('ft-theme', 'dark');
    } else {
      document.documentElement.classList.remove('ft-dark');
      localStorage.setItem('ft-theme', 'light');
    }
  }, [dark]);

  // Compute credit hours for current student
  const creditData = useMemo(() => {
    if (!registrations || !user) return { registered: 0, completed: 0, required: FT_DEFAULT_REQUIRED_HOURS };
    
    const settingsDoc = settings?.find(s => s.id === 'global');
    const requiredHours = settingsDoc?.requiredCreditHours || FT_DEFAULT_REQUIRED_HOURS;

    const myRegs = registrations.filter(r => r.studentId === user.id);
    let registered = 0;
    let completed = 0;

    myRegs.forEach(reg => {
      const place = places?.find(p => p.id === reg.placeId);
      const hours = place?.creditHours || reg.creditHours || 0;
      registered += hours;
      if (reg.status === 'completed') {
        completed += hours;
      }
    });

    return { registered, completed, required: requiredHours };
  }, [registrations, settings, places, user]);

  const userRole = user?.role || 'student';
  const progressPct = creditData.required > 0 ? Math.min(100, Math.round((creditData.completed / creditData.required) * 100)) : 0;

  const notificationsCount = useMemo(() => {
    if (userRole !== 'admin' && userRole !== 'master' && userRole !== 'faculty') return 0;
    const pendingRegsCount = registrations?.filter(r => r.status === 'pending')?.length || 0;
    const changeRequestsCount = registrations?.filter(r => r.changeRequest)?.length || 0;
    const pendingResetsCount = resetRequests?.filter(r => r.status === 'pending')?.length || 0;
    return pendingRegsCount + changeRequestsCount + pendingResetsCount;
  }, [registrations, resetRequests, userRole]);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/' || location.pathname === '';
    return location.pathname.startsWith(path);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = useMemo(() => {
    const items = [
      { path: '/', icon: <LayoutDashboard size={20} />, label: 'Training Places', roles: 'all' },
      { path: '/my-training', icon: <BookOpen size={20} />, label: 'My Training', roles: ['student', 'user'] },
      { path: '/trainer', icon: <ClipboardCheck size={20} />, label: 'My Trainees', roles: ['trainer'] },
      { section: 'Management', roles: ['master', 'admin', 'faculty', 'trainer'] },
      { path: '/manage-places', icon: <MapPin size={20} />, label: 'Manage Places', roles: ['master', 'admin', 'faculty', 'trainer'] },
      { path: '/students', icon: <Users size={20} />, label: 'Students', roles: ['master', 'admin', 'faculty', 'trainer'] },
      { path: '/settings', icon: <Settings size={20} />, label: 'Settings', roles: ['master', 'admin'] },
    ];
    return items.filter(item => {
      if (item.roles === 'all') return true;
      if (userRole === 'master' || userRole === 'admin') return true;
      return item.roles?.includes(userRole);
    });
  }, [userRole]);

  const isStaff = userRole === 'master' || userRole === 'admin' || userRole === 'trainer' || userRole === 'faculty';
  const studentOverviewItems = useMemo(() => navItems.filter(item => item.path === '/' || item.path === '/my-training' || item.path === '/trainer'), [navItems]);
  const otherItems = useMemo(() => navItems.filter(item => item.path !== '/' && item.path !== '/my-training' && item.path !== '/trainer'), [navItems]);

  const renderNavLink = (item) => {
    if (item.section) {
      return <div key={item.section} className="ft-sidebar-section-label">{item.section}</div>;
    }
    return (
      <Link
        key={item.path}
        to={item.path}
        className={`ft-sidebar-link ${isActive(item.path) ? 'active' : ''}`}
        onClick={() => setSidebarOpen(false)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {item.icon}
          <span>{item.label}</span>
        </div>
        {item.path === '/manage-places' && notificationsCount > 0 && (
          <span style={{
            background: 'var(--ft-danger)',
            color: 'white',
            fontSize: '0.7rem',
            fontWeight: 700,
            borderRadius: '999px',
            padding: '0.15rem 0.45rem',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '18px',
            height: '18px',
            boxShadow: '0 2px 5px rgba(239, 68, 68, 0.4)',
            marginRight: '0.5rem'
          }}>
            {notificationsCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="ft-app">
      {/* ── Top Navbar ─────────────────────────────────────── */}
      <nav className="ft-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="ft-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link to="/" className="ft-navbar-brand" style={{ textDecoration: 'none' }}>
            <img src="./logo.png" alt="University Logo" style={{ width: '38px', height: '38px', objectFit: 'contain' }} />
            <div>
              <div className="ft-navbar-brand-text">Field Training</div>
              <div className="ft-navbar-brand-sub">{FT_FACULTY}</div>
            </div>
          </Link>
        </div>

        {/* Credit Hours Bar (desktop) */}
        {(isStudentRole(userRole) || userRole === 'user') && (
          <div className="ft-credit-bar" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="ft-credit-item" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span>🏆</span>
              <span style={{ color: 'var(--ft-text-secondary)', fontWeight: 600 }}>Finished:</span>
              <span className="ft-credit-value" style={{ color: 'var(--ft-success)', fontWeight: 800 }}>
                {creditData.completed}h
              </span>
              <span style={{ color: 'var(--ft-text-muted)' }}>out of</span>
              <span className="ft-credit-value" style={{ color: 'var(--ft-text)', fontWeight: 800 }}>
                {creditData.required}h
              </span>
              <span style={{ color: 'var(--ft-primary)', fontSize: '0.75rem', fontWeight: 700, background: 'var(--ft-primary-bg)', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(190, 18, 60, 0.15)' }}>
                {progressPct}% Finished
              </span>
            </div>
            <div className="ft-credit-divider" />
            <div className="ft-credit-progress-mini" style={{ width: '100px' }}>
              <div className="ft-credit-progress-mini-fill" style={{ width: `${progressPct}%`, background: progressPct >= 100 ? 'var(--ft-success)' : 'var(--ft-primary)' }} />
            </div>
          </div>
        )}

        <div className="ft-navbar-actions">
          <button className="ft-theme-toggle" onClick={() => setDark(!dark)} title={dark ? 'Light Mode' : 'Dark Mode'}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div className="ft-user-menu">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
            >
              {meDoc?.avatar ? (
                <img src={meDoc.avatar} alt="" className="ft-navbar-avatar" />
              ) : (
                <div className="ft-navbar-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ft-primary-bg)', color: 'var(--ft-primary)', fontWeight: 700, fontSize: '0.85rem' }}>
                  {(meDoc?.name || user?.name || '?')[0]?.toUpperCase()}
                </div>
              )}
              <ChevronDown size={14} style={{ color: 'var(--ft-text-muted)', transition: 'transform 0.2s', transform: userMenuOpen ? 'rotate(180deg)' : '' }} />
            </button>

            {userMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 1050 }} onClick={() => setUserMenuOpen(false)} />
                <div className="ft-user-dropdown">
                  <div style={{ padding: '0.75rem 0.85rem', borderBottom: '1px solid var(--ft-border-light)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{meDoc?.name || user?.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)' }}>{meDoc?.email || ''}</div>
                    <span className="ft-badge ft-badge-role" style={{ marginTop: '0.35rem', background: `${FT_ROLE_COLORS[userRole]}15`, color: FT_ROLE_COLORS[userRole] }}>
                      {FT_ROLE_LABELS[userRole] || userRole}
                    </span>
                  </div>
                  {meDoc?.department && (
                    <div style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem', color: 'var(--ft-text-muted)' }}>
                      <GraduationCap size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
                      {meDoc.department}
                    </div>
                  )}
                  <div className="ft-user-dropdown-divider" />
                  <button className="ft-user-dropdown-item" onClick={() => { setShowProfileModal(true); setUserMenuOpen(false); }}>
                    ⚙️ Edit Profile
                  </button>
                  <div className="ft-user-dropdown-divider" />
                  <button className="ft-user-dropdown-item danger" onClick={handleLogout}>
                    <LogOut size={16} /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Sidebar ────────────────────────────────────────── */}
      {sidebarOpen && <div className="ft-sidebar-overlay active" onClick={() => setSidebarOpen(false)} />}
      <aside className={`ft-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <nav className="ft-sidebar-nav">
          {isStaff ? (
            <>
              {/* Student Overview Box Wrapper */}
              <div style={{
                background: 'var(--ft-bg-input)',
                border: '1.5px solid var(--ft-border)',
                borderRadius: 'var(--ft-radius)',
                padding: '0.4rem',
                marginBottom: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem'
              }}>
                <div style={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--ft-primary)',
                  padding: '0.4rem 0.5rem 0.5rem',
                  borderBottom: '1px solid var(--ft-border-light)',
                  marginBottom: '0.25rem',
                  fontFamily: "'Outfit', sans-serif"
                }}>
                  Student Overview
                </div>
                {studentOverviewItems.map(renderNavLink)}
              </div>
              {/* Other Items */}
              {otherItems.map(renderNavLink)}
            </>
          ) : (
            // Student: render normally
            navItems.map(renderNavLink)
          )}
        </nav>

        {/* Sidebar bottom — credit progress for students */}
        {(isStudentRole(userRole) || userRole === 'user') && (
          <div style={{ marginTop: 'auto', padding: '1.25rem 0.5rem 0', borderTop: '1px solid var(--ft-border-light)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--ft-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Progress
            </div>
            <div className="ft-progress-bar" style={{ marginBottom: '0.5rem' }}>
              <div className="ft-progress-bar-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--ft-text-muted)' }}>
              <span>{creditData.completed}h completed</span>
              <span style={{ fontWeight: 700, color: progressPct >= 100 ? 'var(--ft-success)' : 'var(--ft-primary)' }}>{progressPct}%</span>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Content ───────────────────────────────────── */}
      <main className="ft-main">
        <div style={{ flex: 1 }}>
           <Outlet context={{ meDoc, creditData, userRole, places, registrations, settings, resetRequests }} />
        </div>

        {/* Footer / Downbar */}
        <footer className="ft-footer">
          <div className="ft-footer-content">
            <div className="ft-footer-left" style={{ color: 'var(--ft-text-muted)', fontSize: '0.78rem' }}>
              <span>Designed & Programmed by <strong style={{ color: 'var(--ft-text)', fontWeight: 600 }}>Abdullah Amr Maged</strong></span>
              <span style={{ margin: '0 0.5rem', opacity: 0.4 }}>|</span>
              <span>Teaching Assistant, Faculty of Science, AIU</span>
            </div>
            <div className="ft-footer-right" style={{ color: 'var(--ft-text-muted)', fontSize: '0.78rem', fontWeight: 500 }}>
              AIU Field Training System
            </div>
          </div>
        </footer>
      </main>

      {/* ── Mobile Bottom Nav ──────────────────────────────── */}
      <nav className="ft-mobile-nav">
        <Link to="/" className={`ft-mobile-nav-item ${isActive('/') && !location.pathname.includes('/my-training') && !location.pathname.includes('/manage') && !location.pathname.includes('/students') && !location.pathname.includes('/trainer') && !location.pathname.includes('/settings') ? 'active' : ''}`}>
          <LayoutDashboard size={22} />
          <span>Places</span>
        </Link>
        {(isStudentRole(userRole) || userRole === 'user' || userRole === 'master' || userRole === 'admin') && (
          <Link to="/my-training" className={`ft-mobile-nav-item ${isActive('/my-training') ? 'active' : ''}`}>
            <BookOpen size={22} />
            <span>My Training</span>
          </Link>
        )}
        {isTrainerRole(userRole) && (
          <Link to="/trainer" className={`ft-mobile-nav-item ${isActive('/trainer') ? 'active' : ''}`}>
            <ClipboardCheck size={22} />
            <span>Trainees</span>
          </Link>
        )}
        {isFacultyRole(userRole) && (
          <Link to="/manage-places" className={`ft-mobile-nav-item ${isActive('/manage-places') ? 'active' : ''}`}>
            <MapPin size={22} />
            <span>Manage</span>
          </Link>
        )}
        {isFacultyRole(userRole) && (
          <Link to="/students" className={`ft-mobile-nav-item ${isActive('/students') ? 'active' : ''}`}>
            <Users size={22} />
            <span>Students</span>
          </Link>
        )}
      </nav>

      {/* Profile Edit Modal */}
    {showProfileModal && (
      <div className="ft-modal-overlay">
        <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
          <div className="ft-modal-header">
            <h3 className="ft-modal-title">⚙️ Edit Account Profile</h3>
            <button className="ft-btn ft-btn-ghost ft-btn-icon" onClick={() => { setShowProfileModal(false); setProfileError(''); }}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleProfileSubmit}>
            <div className="ft-modal-body">
              {profileError && (
                <div style={{ backgroundColor: 'var(--ft-danger-bg)', color: 'var(--ft-danger)', padding: '0.75rem 1rem', borderRadius: 'var(--ft-radius)', marginBottom: '1.25rem', fontSize: '0.82rem', fontWeight: 500, border: '1.5px solid rgba(239, 68, 68, 0.15)' }}>
                  ❌ {profileError}
                </div>
              )}

              {profileSuccess && (
                <div style={{ backgroundColor: 'var(--ft-success-bg)', color: 'var(--ft-success)', padding: '0.75rem 1rem', borderRadius: 'var(--ft-radius)', marginBottom: '1.25rem', fontSize: '0.82rem', fontWeight: 600, border: '1.5px solid rgba(34, 197, 94, 0.15)' }}>
                  ✅ {profileSuccess}
                </div>
              )}

              <div className="ft-input-group">
                <label className="ft-label">Full Name *</label>
                <input 
                  type="text" 
                  className="ft-input" 
                  required 
                  value={profileForm.name} 
                  onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} 
                />
              </div>
              <div className="ft-input-group">
                <label className="ft-label">Username *</label>
                <input 
                  type="text" 
                  className="ft-input" 
                  required 
                  value={profileForm.username} 
                  onChange={e => setProfileForm({ ...profileForm, username: e.target.value })} 
                />
              </div>
              <div className="ft-input-group">
                <label className="ft-label">University Email *</label>
                <input 
                  type="email" 
                  className="ft-input" 
                  required 
                  value={profileForm.email} 
                  onChange={e => setProfileForm({ ...profileForm, email: e.target.value })} 
                />
              </div>

              {isStudentRole(profileForm.role) ? (
                <div className="ft-input-group">
                  <label className="ft-label">University ID Number *</label>
                  <input 
                    type="text" 
                    className="ft-input" 
                    required 
                    value={profileForm.universityId} 
                    onChange={e => setProfileForm({ ...profileForm, universityId: e.target.value })} 
                  />
                </div>
              ) : (
                <div className="ft-input-group">
                  <label className="ft-label">Supervisor Title *</label>
                  <input 
                    type="text" 
                    className="ft-input" 
                    required 
                    value={profileForm.title} 
                    onChange={e => setProfileForm({ ...profileForm, title: e.target.value })} 
                  />
                </div>
              )}

              <div className="ft-input-group">
                <label className="ft-label">New Password (Leave blank to keep current)</label>
                <input 
                  type="password" 
                  className="ft-input" 
                  placeholder="Enter new password"
                  value={profileForm.password} 
                  onChange={e => setProfileForm({ ...profileForm, password: e.target.value })} 
                />
              </div>

              {profileForm.password.trim() && (
                <div className="ft-input-group" style={{ marginBottom: 0 }}>
                  <label className="ft-label">Confirm New Password</label>
                  <input 
                    type="password" 
                    className="ft-input" 
                    placeholder="Confirm new password"
                    value={profileForm.confirmPassword} 
                    onChange={e => setProfileForm({ ...profileForm, confirmPassword: e.target.value })} 
                  />
                </div>
              )}

              {/* Google Account Connection */}
              <div className="ft-input-group" style={{ borderTop: '1px solid var(--ft-border-light)', paddingTop: '1rem', marginTop: '1rem', marginBottom: 0 }}>
                <label className="ft-label">Google Account Connection</label>
                {meDoc?.googleEmail ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem', color: 'var(--ft-success)', fontWeight: 600 }}>
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: 16, height: 16 }} />
                    Linked: {meDoc.googleEmail}
                    <span className="ft-badge ft-badge-success" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Active</span>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={handleLinkGoogle}
                      className="ft-btn ft-btn-secondary ft-btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.5rem 0.85rem' }}
                    >
                      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: 16, height: 16 }} />
                      Link Google Account
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="ft-modal-footer">
              <button type="button" className="ft-btn ft-btn-secondary" style={{ flex: 1 }} onClick={() => { setShowProfileModal(false); setProfileError(''); }}>
                Cancel
              </button>
              <button type="submit" className="ft-btn ft-btn-primary" style={{ flex: 1 }} disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </div>
  );
}
