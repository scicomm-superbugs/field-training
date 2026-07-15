import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { Lock, User, Mail, GraduationCap, ArrowLeft, Key } from 'lucide-react';
import { db, firestore, getCollectionName } from './db';
import { collection, query, where, getDocs } from 'firebase/firestore';
import bcrypt from 'bcryptjs';
import './fieldtraining.css';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [completionData, setCompletionData] = useState(null);
  const [completeForm, setCompleteForm] = useState({
    name: '',
    email: '',
    username: '',
    universityId: '',
    title: '',
    role: 'student',
    department: '',
    password: '',
    confirmPassword: ''
  });

  const [resetMode, setResetMode] = useState(null); // null, 'request', 'reset'
  const [resetForm, setResetForm] = useState({
    username: '',
    email: '',
    universityId: '',
    title: '',
    role: 'student',
    password: '',
    confirmPassword: ''
  });
  const [resetSuccess, setResetSuccess] = useState('');
  
  const { login, loginWithGoogle, completeGoogleRegistration, user } = useAuth();
  const navigate = useNavigate();

  // If already logged in, redirect
  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoggingIn(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setIsLoggingIn(true);
    try {
      const res = await loginWithGoogle();
      if (res && res.needsCompletion) {
        setCompletionData(res.googleData);
        setCompleteForm(prev => ({
          ...prev,
          name: res.googleData.name || '',
          email: '', // Don't prefill email since it must be different!
          role: 'student'
        }));
        setIsLoggingIn(false);
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.message);
      setIsLoggingIn(false);
    }
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!completeForm.email.trim().toLowerCase().endsWith('@aiu.edu.eg')) {
      setError('University email must be a valid @aiu.edu.eg address');
      return;
    }

    if (completeForm.email.trim().toLowerCase() === completionData.email.toLowerCase()) {
      setError('University email must be different from your Google account email');
      return;
    }

    if (completeForm.password !== completeForm.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (completeForm.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoggingIn(true);
    try {
      await completeGoogleRegistration(completionData, completeForm);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setIsLoggingIn(false);
    }
  };

  const handleCompleteChange = (e) => {
    setCompleteForm({ ...completeForm, [e.target.name]: e.target.value });
  };

  const handleRequestResetSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResetSuccess('');
    setIsLoggingIn(true);

    try {
      const sciCol = getCollectionName('scientists');
      const q = query(
        collection(firestore, sciCol),
        where('username', '==', resetForm.username.trim()),
        where('email', '==', resetForm.email.trim())
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setError('Invalid username or email combination.');
        setIsLoggingIn(false);
        return;
      }

      const reqCol = getCollectionName('ft_reset_requests');
      const reqQ = query(
        collection(firestore, reqCol),
        where('username', '==', resetForm.username.trim()),
        where('email', '==', resetForm.email.trim())
      );
      const reqSnap = await getDocs(reqQ);

      if (reqSnap.empty) {
        await db.ft_reset_requests.add({
          username: resetForm.username.trim(),
          email: resetForm.email.trim(),
          status: 'pending',
          createdAt: new Date().toISOString()
        });
      }

      setResetSuccess('Reset request sent to administrator! Once approved, you can reset your password.');
    } catch (err) {
      setError('Failed to submit request: ' + err.message);
    }
    setIsLoggingIn(false);
  };

  const handleResetPasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResetSuccess('');

    if (resetForm.password !== resetForm.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (resetForm.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoggingIn(true);
    try {
      const reqCol = getCollectionName('ft_reset_requests');
      const q = query(
        collection(firestore, reqCol),
        where('username', '==', resetForm.username.trim()),
        where('email', '==', resetForm.email.trim()),
        where('status', '==', 'approved')
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setError('No approved password reset request found for this username and email. Please check back later or submit a request.');
        setIsLoggingIn(false);
        return;
      }

      const sciCol = getCollectionName('scientists');
      const sq = query(
        collection(firestore, sciCol),
        where('username', '==', resetForm.username.trim()),
        where('email', '==', resetForm.email.trim())
      );
      const sSnap = await getDocs(sq);
      if (sSnap.empty) {
        setError('Account details do not match.');
        setIsLoggingIn(false);
        return;
      }

      const userDoc = { id: sSnap.docs[0].id, ...sSnap.docs[0].data() };
      const isStudent = userDoc.role === 'student' || userDoc.role === 'user' || !userDoc.role;

      if (isStudent) {
        if (userDoc.universityId !== resetForm.universityId.trim()) {
          setError('Invalid University ID Number.');
          setIsLoggingIn(false);
          return;
        }
      } else {
        if (userDoc.title?.toLowerCase().trim() !== resetForm.title?.toLowerCase().trim()) {
          setError('Invalid Supervisor Title.');
          setIsLoggingIn(false);
          return;
        }
      }

      const salt = await bcrypt.genSalt(4);
      const passwordHash = await bcrypt.hash(resetForm.password, salt);
      await db.scientists.update(userDoc.id, { passwordHash });

      await db.ft_reset_requests.delete(snap.docs[0].id);

      setResetSuccess('Password changed successfully! You can now sign in with your new password.');
      setTimeout(() => {
        setResetMode(null);
        setResetSuccess('');
        setResetForm({ username: '', email: '', universityId: '', title: '', role: 'student', password: '', confirmPassword: '' });
      }, 2000);
    } catch (err) {
      setError('Failed to reset password: ' + err.message);
    }
    setIsLoggingIn(false);
  };

  return (
    <div className="ft-app" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', padding: '1rem' }}>
      <div className="ft-card ft-animate-in" style={{ maxWidth: '440px', width: '100%', padding: '2rem' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.0rem' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'var(--ft-bg-card)', border: '1.5px solid var(--ft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', boxShadow: 'var(--ft-shadow-md)' }}>
            <img src="./logo.png" alt="University Logo" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
          </div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.5rem', fontWeight: 800, color: 'var(--ft-primary)', marginBottom: '0.25rem' }}>
            {completionData ? 'Complete Registration' : resetMode === 'request' ? 'Request Password Reset' : resetMode === 'reset' ? 'Reset Password' : 'Field Training Portal'}
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>
            {completionData ? 'Fill in your university details to continue' : resetMode === 'request' ? 'Send a reset request to your administrator' : resetMode === 'reset' ? 'Enter approved details to reset password' : 'Faculty of Science · Alamein University'}
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <div style={{ 
            backgroundColor: 'var(--ft-danger-bg)', 
            color: 'var(--ft-danger)', 
            padding: '0.75rem 1rem', 
            borderRadius: 'var(--ft-radius)', 
            marginBottom: '1rem', 
            fontSize: '0.82rem',
            fontWeight: 500,
            border: '1.5px solid rgba(239, 68, 68, 0.15)'
          }}>
            ❌ {error}
          </div>
        )}

        {/* Success alert */}
        {resetSuccess && (
          <div style={{ 
            backgroundColor: 'var(--ft-success-bg)', 
            color: 'var(--ft-success)', 
            padding: '0.75rem 1rem', 
            borderRadius: 'var(--ft-radius)', 
            marginBottom: '1rem', 
            fontSize: '0.82rem',
            fontWeight: 600,
            border: '1.5px solid rgba(34, 197, 94, 0.15)'
          }}>
            ✅ {resetSuccess}
          </div>
        )}

        {/* Dynamic Completion Form Card */}
        {completionData ? (
          <form onSubmit={handleCompleteSubmit}>
            <div className="ft-input-group">
              <label className="ft-label">Full Name *</label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="text" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  name="name"
                  required
                  value={completeForm.name}
                  onChange={handleCompleteChange}
                  placeholder="e.g. Abdullah Amr"
                />
              </div>
            </div>

            <div className="ft-input-group">
              <label className="ft-label">University Email *</label>
              <div style={{ position: 'relative' }}>
                <Mail size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="email" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  name="email"
                  required
                  value={completeForm.email}
                  onChange={handleCompleteChange}
                  placeholder="e.g. student@aiu.edu.eg"
                />
              </div>
            </div>

            <div className="ft-input-group">
              <label className="ft-label">Account Type *</label>
              <select 
                className="ft-select" 
                name="role" 
                required 
                value={completeForm.role} 
                onChange={handleCompleteChange}
              >
                <option value="student">Student</option>
                <option value="trainer">Supervisor / Instructor</option>
              </select>
            </div>

            {completeForm.role === 'student' ? (
              <div className="ft-input-group">
                <label className="ft-label">University ID Number *</label>
                <div style={{ position: 'relative' }}>
                  <GraduationCap size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                  <input 
                    type="text" 
                    className="ft-input" 
                    style={{ paddingLeft: '2.75rem' }}
                    name="universityId"
                    required
                    value={completeForm.universityId}
                    onChange={handleCompleteChange}
                    placeholder="e.g. 202100456"
                  />
                </div>
              </div>
            ) : (
              <div className="ft-input-group">
                <label className="ft-label">Supervisor Title *</label>
                <div style={{ position: 'relative' }}>
                  <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                  <input 
                    type="text" 
                    className="ft-input" 
                    style={{ paddingLeft: '2.75rem' }}
                    name="title"
                    required
                    value={completeForm.title}
                    onChange={handleCompleteChange}
                    placeholder="e.g. Teaching Assistant, Professor, Doctor"
                  />
                </div>
              </div>
            )}

            <div className="ft-input-group">
              <label className="ft-label">Username *</label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="text" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  name="username"
                  required
                  value={completeForm.username}
                  onChange={handleCompleteChange}
                  placeholder="Choose login username"
                />
              </div>
            </div>

            <div className="ft-input-group">
              <label className="ft-label">Department *</label>
              <select 
                className="ft-select" 
                name="department" 
                required 
                value={completeForm.department} 
                onChange={handleCompleteChange}
              >
                <option value="">Select Department</option>
                <option value="Biotechnology">Biotechnology</option>
                <option value="Industrial Chemistry">Industrial Chemistry</option>
                <option value="Sustainable Energy">Sustainable Energy</option>
              </select>
            </div>

            <div className="ft-input-group">
              <label className="ft-label">Password *</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="password" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  name="password"
                  required
                  value={completeForm.password}
                  onChange={handleCompleteChange}
                  placeholder="Set password (Min 6 chars)"
                />
              </div>
            </div>

            <div className="ft-input-group" style={{ marginBottom: '1.5rem' }}>
              <label className="ft-label">Confirm Password *</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="password" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  name="confirmPassword"
                  required
                  value={completeForm.confirmPassword}
                  onChange={handleCompleteChange}
                  placeholder="Confirm your password"
                />
              </div>
            </div>

            <button type="submit" className="ft-btn ft-btn-primary ft-w-full" style={{ padding: '0.8rem 1.5rem', marginBottom: '0.75rem' }} disabled={isLoggingIn}>
              {isLoggingIn ? 'Completing registration...' : 'Complete & Log In'}
            </button>

            <button 
              type="button" 
              className="ft-btn ft-btn-secondary ft-w-full" 
              onClick={() => { setCompletionData(null); setError(''); }}
              disabled={isLoggingIn}
            >
              Cancel
            </button>
          </form>
        ) : resetMode === 'request' ? (
          /* Request Password Reset Form */
          <form onSubmit={handleRequestResetSubmit}>
            <div className="ft-input-group">
              <label className="ft-label">Username</label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="text" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="Enter your username"
                  required
                  value={resetForm.username}
                  onChange={e => setResetForm({ ...resetForm, username: e.target.value })}
                />
              </div>
            </div>

            <div className="ft-input-group" style={{ marginBottom: '1.5rem' }}>
              <label className="ft-label">University Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="email" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="Enter your university email"
                  required
                  value={resetForm.email}
                  onChange={e => setResetForm({ ...resetForm, email: e.target.value })}
                />
              </div>
            </div>

            <button type="submit" className="ft-btn ft-btn-primary ft-w-full" style={{ padding: '0.8rem 1.5rem', marginBottom: '1rem' }} disabled={isLoggingIn}>
              {isLoggingIn ? 'Sending...' : 'Send Reset Request'}
            </button>

            <button 
              type="button" 
              className="ft-btn ft-btn-secondary ft-w-full" 
              style={{ marginBottom: '1.5rem' }}
              onClick={() => { setResetMode('reset'); setError(''); setResetSuccess(''); }}
            >
              🔑 Already Approved? Reset Password
            </button>

            <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--ft-text-secondary)' }}>
              <button 
                type="button" 
                onClick={() => { setResetMode(null); setError(''); setResetSuccess(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--ft-primary)', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <ArrowLeft size={14} /> Back to Sign In
              </button>
            </div>
          </form>
        ) : resetMode === 'reset' ? (
          /* Actual Password Reset Form */
          <form onSubmit={handleResetPasswordSubmit}>
            <div className="ft-input-group">
              <label className="ft-label">Username</label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="text" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="Enter your username"
                  required
                  value={resetForm.username}
                  onChange={e => setResetForm({ ...resetForm, username: e.target.value })}
                />
              </div>
            </div>

            <div className="ft-input-group">
              <label className="ft-label">University Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="email" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="Enter your university email"
                  required
                  value={resetForm.email}
                  onChange={e => setResetForm({ ...resetForm, email: e.target.value })}
                />
              </div>
            </div>

            <div className="ft-input-group">
              <label className="ft-label">Account Type *</label>
              <select 
                className="ft-select" 
                required 
                value={resetForm.role} 
                onChange={e => setResetForm({ ...resetForm, role: e.target.value })}
              >
                <option value="student">Student</option>
                <option value="trainer">Supervisor</option>
                <option value="admin">Administrator</option>
              </select>
            </div>

            {resetForm.role === 'student' ? (
              <div className="ft-input-group">
                <label className="ft-label">University ID Number *</label>
                <div style={{ position: 'relative' }}>
                  <GraduationCap size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                  <input 
                    type="text" 
                    className="ft-input" 
                    style={{ paddingLeft: '2.75rem' }}
                    required
                    value={resetForm.universityId}
                    onChange={e => setResetForm({ ...resetForm, universityId: e.target.value })}
                    placeholder="e.g. 202100456"
                  />
                </div>
              </div>
            ) : (
              <div className="ft-input-group">
                <label className="ft-label">Supervisor Title *</label>
                <div style={{ position: 'relative' }}>
                  <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                  <input 
                    type="text" 
                    className="ft-input" 
                    style={{ paddingLeft: '2.75rem' }}
                    required
                    value={resetForm.title}
                    onChange={e => setResetForm({ ...resetForm, title: e.target.value })}
                    placeholder="e.g. Teaching Assistant, Professor"
                  />
                </div>
              </div>
            )}

            <div className="ft-input-group">
              <label className="ft-label">New Password *</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="password" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="Enter new password (Min 6 chars)"
                  required
                  value={resetForm.password}
                  onChange={e => setResetForm({ ...resetForm, password: e.target.value })}
                />
              </div>
            </div>

            <div className="ft-input-group" style={{ marginBottom: '1.5rem' }}>
              <label className="ft-label">Confirm New Password *</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                <input 
                  type="password" 
                  className="ft-input" 
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="Confirm new password"
                  required
                  value={resetForm.confirmPassword}
                  onChange={e => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                />
              </div>
            </div>

            <button type="submit" className="ft-btn ft-btn-primary ft-w-full" style={{ padding: '0.8rem 1.5rem', marginBottom: '1rem' }} disabled={isLoggingIn}>
              {isLoggingIn ? 'Resetting...' : 'Change Password'}
            </button>

            <button 
              type="button" 
              className="ft-btn ft-btn-secondary ft-w-full" 
              style={{ marginBottom: '1.5rem' }}
              onClick={() => { setResetMode('request'); setError(''); setResetSuccess(''); }}
            >
              Need Approval? Send Request
            </button>

            <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--ft-text-secondary)' }}>
              <button 
                type="button" 
                onClick={() => { setResetMode(null); setError(''); setResetSuccess(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--ft-primary)', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <ArrowLeft size={14} /> Back to Sign In
              </button>
            </div>
          </form>
        ) : (
          /* Standard Sign-In Form */
          <>
            <form onSubmit={handleSubmit}>
              <div className="ft-input-group">
                <label className="ft-label">Username or Email</label>
                <div style={{ position: 'relative' }}>
                  <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                  <input 
                    type="text" 
                    className="ft-input" 
                    style={{ paddingLeft: '2.75rem' }}
                    placeholder="Enter username or email"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                  />
                </div>
              </div>

              <div className="ft-input-group" style={{ marginBottom: '1.5rem' }}>
                <label className="ft-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ft-text-muted)' }} />
                  <input 
                    type="password" 
                    className="ft-input" 
                    style={{ paddingLeft: '2.75rem' }}
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-0.75rem', marginBottom: '1.25rem' }}>
                <button 
                  type="button" 
                  onClick={() => { setResetMode('request'); setError(''); setResetSuccess(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--ft-primary)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', padding: 0 }}
                >
                  Forgot Password?
                </button>
              </div>

              <button type="submit" className="ft-btn ft-btn-primary ft-w-full" style={{ padding: '0.8rem 1.5rem', marginBottom: '1rem' }} disabled={isLoggingIn}>
                {isLoggingIn ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', margin: '1rem 0' }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--ft-border)' }}></div>
              <span style={{ padding: '0 10px', color: 'var(--ft-text-muted)', fontSize: '12px', fontWeight: 600 }}>OR</span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--ft-border)' }}></div>
            </div>

            <button 
              onClick={handleGoogleLogin} 
              disabled={isLoggingIn}
              style={{ 
                width: '100%', 
                padding: '10px', 
                background: 'var(--ft-bg-card)', 
                border: '1.5px solid var(--ft-border)', 
                borderRadius: 'var(--ft-radius)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '10px', 
                cursor: 'pointer', 
                fontWeight: 600, 
                color: 'var(--ft-text-secondary)',
                boxShadow: 'var(--ft-shadow-sm)',
                marginBottom: '1rem',
                transition: 'background 0.25s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ft-bg-card-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--ft-bg-card)'}
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: 18, height: 18 }} />
              Sign in with Google
            </button>
            
            <div style={{ textAlign: 'center', fontSize: '0.85rem', marginTop: '1.5rem', color: 'var(--ft-text-secondary)', fontWeight: 500 }}>
              Don't have an account? <Link to="/register" style={{ fontWeight: 700, color: 'var(--ft-primary)', textDecoration: 'none' }}>Register here</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
