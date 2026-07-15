export const FT_UNIVERSITY = 'Alamein International University';
export const FT_FACULTY = 'Faculty of Science';

export const FT_DEPARTMENTS = [
  'Biotechnology',
  'Industrial Chemistry',
  'Sustainable Energy'
];

export const FT_ROLES = {
  ADMIN: 'admin',
  FACULTY: 'faculty',
  TRAINER: 'trainer',
  STUDENT: 'student',
  MASTER: 'master'
};

export const FT_ROLE_LABELS = {
  master: 'System Administrator (Master)',
  admin: 'Administrator',
  faculty: 'Academic Advisor / Professor',
  trainer: 'Field Trainer / Supervisor',
  student: 'Science Student',
  user: 'Student' // Fallback for legacy user role
};

export const FT_ROLE_COLORS = {
  master: '#8b5cf6', // purple
  admin: '#8b5cf6', // purple
  faculty: '#3b82f6', // blue
  trainer: '#14b8a6', // teal
  student: '#22c55e', // green
  user: '#22c55e' // green
};

export const FT_REG_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

export const FT_REG_STATUS_LABELS = {
  pending: 'Pending Approval',
  active: 'In Training',
  completed: 'Completed',
  failed: 'Needs Re-training'
};

export const FT_REG_STATUS_COLORS = {
  pending: '#f59e0b', // warning warm gold
  active: '#3b82f6', // info blue
  completed: '#22c55e', // success green
  failed: '#ef4444' // danger red
};

export const FT_REG_STATUS_ICONS = {
  pending: '🟡',
  active: '🔵',
  completed: '✅',
  failed: '🔴'
};

export const FT_DEFAULT_REQUIRED_HOURS = 100;

export const isAdminRole = (role) => role === 'admin' || role === 'master';
export const isFacultyRole = (role) => role === 'faculty' || role === 'admin' || role === 'master';
export const isTrainerRole = (role) => role === 'trainer' || role === 'admin' || role === 'master';
export const isStudentRole = (role) => role === 'student' || role === 'user';

export const cleanWaveName = (name) => {
  if (!name) return '—';
  return name.replace(/\((Wave\s+\d+:\s*)/i, '(');
};
