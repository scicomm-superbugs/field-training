import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { db } from './db';
import bcrypt from 'bcryptjs';

// Auto-seed a default administrator to let the user log in immediately
async function seedDefaultAdmin() {
  try {
    const existing = await db.scientists.where('username').equals('admin').first();
    if (!existing) {
      const salt = await bcrypt.genSalt(4);
      const hash = await bcrypt.hash('admin123', salt);
      await db.scientists.add({
        username: 'admin',
        passwordHash: hash,
        name: 'System Administrator',
        email: 'admin@aiu.edu.eg',
        department: 'Biotechnology',
        employeeId: 'ADMIN-001',
        role: 'admin',
        accountStatus: 'active',
        createdAt: new Date().toISOString()
      });
      console.log('Seeded default admin account (username: admin, password: admin123)');
    }
  } catch (err) {
    console.error('Error seeding default admin account:', err);
  }
}

seedDefaultAdmin();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
