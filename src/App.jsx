import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import FTLayout from './FTLayout';
import FTDashboard from './FTDashboard';
import FTPlaceDetails from './FTPlaceDetails';
import FTMyTraining from './FTMyTraining';
import FTAdminPlaces from './FTAdminPlaces';
import FTAdminStudents from './FTAdminStudents';
import FTAdminSettings from './FTAdminSettings';
import FTTrainerDashboard from './FTTrainerDashboard';
import FTProtectedRoute from './FTProtectedRoute';
import Login from './Login';
import Register from './Register';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Authentication routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected routes */}
          <Route element={<FTProtectedRoute />}>
            <Route path="/" element={<FTLayout />}>
              {/* Home / Grid dashboard */}
              <Route index element={<FTDashboard />} />

              {/* Details and Student tracking */}
              <Route path="place/:placeId" element={<FTPlaceDetails />} />
              <Route path="my-training" element={<FTMyTraining />} />

              {/* Admin/Faculty places */}
              <Route element={<FTProtectedRoute requireRole={['master', 'admin']} />}>
                <Route path="manage-places" element={<FTAdminPlaces />} />
              </Route>

              {/* Students list */}
              <Route element={<FTProtectedRoute requireRole={['master', 'admin']} />}>
                <Route path="students" element={<FTAdminStudents />} />
              </Route>

              {/* Admin configuration settings */}
              <Route element={<FTProtectedRoute requireRole={['master', 'admin']} />}>
                <Route path="settings" element={<FTAdminSettings />} />
              </Route>

              {/* Trainer evaluating list */}
              <Route element={<FTProtectedRoute requireRole={['trainer', 'master', 'admin']} />}>
                <Route path="trainer" element={<FTTrainerDashboard />} />
              </Route>
            </Route>
          </Route>

          {/* Route fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
