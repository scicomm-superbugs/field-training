import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { db } from './db';
import bcrypt from 'bcryptjs';
import { useAuth } from './context/AuthContext';
import './fieldtraining.css';

export default function Register() {
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    department: '',
    universityId: '',
    title: '',
    role: 'student',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  // If already logged in, redirect
  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsRegistering(true);

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setIsRegistering(false);
      return;
    }
    
    // Check if username or email is already registered
    const existing = await db.scientists.where('username').equals(formData.username).first()
      || await db.scientists.where('email').equals(formData.username).first();
    if (existing) {
      setError('Username is already in use.');
      setIsRegistering(false);
      return;
    }

    if (!formData.email || !formData.email.toLowerCase().endsWith('@aiu.edu.eg')) {
      setError('Only @aiu.edu.eg university email addresses are allowed.');
      setIsRegistering(false);
      return;
    }

    const existingEmail = await db.scientists.where('email').equals(formData.email).first();
    if (existingEmail) {
      setError('Email is already in use.');
      setIsRegistering(false);
      return;
    }

    try {
      const salt = await bcrypt.genSalt(4);
      const hash = await bcrypt.hash(formData.password, salt);
      const isSupervisor = formData.role === 'trainer';
      const generatedId = (isSupervisor ? 'SV-' : 'ST-') + Math.floor(1000 + Math.random() * 9000);

      await db.scientists.add({
        username: formData.username,
        passwordHash: hash,
        name: formData.name,
        email: formData.email || '',
        department: formData.department,
        universityId: isSupervisor ? '' : formData.universityId.trim(),
        title: isSupervisor ? (formData.title ? formData.title.trim() : 'Supervisor') : '',
        role: isSupervisor ? 'trainer' : 'student',
        accountStatus: 'active', // Active immediately for easier user entry
        employeeId: generatedId,
        university: 'Alamein International University',
        faculty: 'Faculty of Science',
        profileViews: 0,
        createdAt: new Date().toISOString()
      });

      setSuccess('Registration successful! You can now log in.');
      setFormData({ name: '', username: '', email: '', password: '', confirmPassword: '', department: '', universityId: '', title: '', role: 'student' });
      setIsRegistering(false);
    } catch (err) {
      setError('Registration failed: ' + err.message);
      setIsRegistering(false);
    }
  };

  return (
    <div className="ft-app" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', padding: '2rem 1rem' }}>
      <div className="ft-card ft-animate-in" style={{ maxWidth: '420px', width: '100%', padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'var(--ft-bg-card)', border: '1.5px solid var(--ft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', boxShadow: 'var(--ft-shadow-md)' }}>
            <img src="/logo.png" alt="University Logo" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
          </div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.5rem', fontWeight: 800, color: 'var(--ft-primary)', marginBottom: '0.25rem' }}>
            {formData.role === 'student' ? '🎓 Student Registration' : '🧑‍🏫 Supervisor Registration'}
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>
            Field Training Portal · Faculty of Science
          </div>
        </div>

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

        {success && (
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
            ✅ {success}
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
              Go to <Link to="/login" style={{ color: 'var(--ft-primary)', textDecoration: 'underline' }}>Login page</Link>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="ft-input-group">
            <label className="ft-label">Full Name *</label>
            <input type="text" className="ft-input" name="name" required value={formData.name} onChange={handleChange} placeholder="e.g. Abdullah Amr Maged" />
          </div>

          <div className="ft-input-group">
            <label className="ft-label">Account Type *</label>
            <select className="ft-select" name="role" required value={formData.role} onChange={handleChange}>
              <option value="student">Student</option>
              <option value="trainer">Supervisor / Instructor</option>
            </select>
          </div>

          {formData.role === 'student' ? (
            <div className="ft-input-group">
              <label className="ft-label">University ID Number *</label>
              <input type="text" className="ft-input" name="universityId" required value={formData.universityId} onChange={handleChange} placeholder="e.g. 202100456" />
            </div>
          ) : (
            <div className="ft-input-group">
              <label className="ft-label">Supervisor Title *</label>
              <input type="text" className="ft-input" name="title" required value={formData.title} onChange={handleChange} placeholder="e.g. Teaching Assistant, Professor, Doctor" />
            </div>
          )}

          <div className="ft-input-group">
            <label className="ft-label">Username *</label>
            <input type="text" className="ft-input" name="username" required value={formData.username} onChange={handleChange} placeholder="Username for login" />
          </div>

          <div className="ft-input-group">
            <label className="ft-label">Email Address *</label>
            <input type="email" className="ft-input" name="email" required value={formData.email} onChange={handleChange} placeholder="name@example.com" />
          </div>

          <div className="ft-input-group">
            <label className="ft-label">Department *</label>
            <select className="ft-select" name="department" required value={formData.department} onChange={handleChange}>
              <option value="">Select Department</option>
              <option value="Biotechnology">Biotechnology</option>
              <option value="Industrial Chemistry">Industrial Chemistry</option>
              <option value="Sustainable Energy">Sustainable Energy</option>
            </select>
          </div>

          <div className="ft-input-group">
            <label className="ft-label">Password *</label>
            <input type="password" className="ft-input" name="password" required value={formData.password} onChange={handleChange} placeholder="Min 6 characters" />
          </div>

          <div className="ft-input-group" style={{ marginBottom: '1.5rem' }}>
            <label className="ft-label">Confirm Password *</label>
            <input type="password" className="ft-input" name="confirmPassword" required value={formData.confirmPassword} onChange={handleChange} placeholder="Confirm password" />
          </div>

          <button type="submit" className="ft-btn ft-btn-primary ft-w-full" disabled={isRegistering}>
            {isRegistering ? 'Registering...' : 'Register'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: '0.85rem', marginTop: '1.5rem', color: 'var(--ft-text-secondary)', fontWeight: 500 }}>
          Already have an account? <Link to="/login" style={{ fontWeight: 700, color: 'var(--ft-primary)', textDecoration: 'none' }}>Login here</Link>
        </div>
      </div>
    </div>
  );
}
