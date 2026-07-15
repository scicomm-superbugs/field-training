import { createContext, useState, useEffect, useContext } from 'react';
import { db, getFirebaseAuth } from '../db';
import { signInAnonymously, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import bcrypt from 'bcryptjs';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initialize auth
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedUserId = localStorage.getItem('ft_userId') || sessionStorage.getItem('ft_userId');
        if (storedUserId) {
          const scientist = await db.scientists.get(String(storedUserId));
          if (scientist) {
            setUser({
              id: scientist.id,
              username: scientist.username,
              name: scientist.name,
              role: scientist.role || 'student',
              avatar: scientist.avatar
            });
            
            // Sync with Firebase auth session for firestore permissions
            const fbAuth = getFirebaseAuth();
            if (!fbAuth.currentUser) {
              await signInAnonymously(fbAuth);
            }
          } else {
            // Clear invalid session
            localStorage.removeItem('ft_userId');
            sessionStorage.removeItem('ft_userId');
          }
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const login = async (username, password) => {
    let scientist = await db.scientists.where('username').equals(username).first();
    if (!scientist) {
      scientist = await db.scientists.where('email').equals(username).first();
    }
    
    if (!scientist) {
      throw new Error('Invalid username or password');
    }
    
    const isMatch = await bcrypt.compare(password, scientist.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid username or password');
    }
    
    if (scientist.accountStatus === 'pending') {
      throw new Error('Your account is pending approval by an administrator.');
    }

    const userData = {
      id: scientist.id,
      username: scientist.username,
      name: scientist.name,
      role: scientist.role || 'student',
      avatar: scientist.avatar
    };

    setUser(userData);
    localStorage.setItem('ft_userId', scientist.id);
    sessionStorage.setItem('ft_userId', scientist.id);

    try {
      const auth = getFirebaseAuth();
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }
    } catch (authErr) {
      console.warn('Anonymous Firebase login failed:', authErr.message);
    }

    return userData;
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const auth = getFirebaseAuth();
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const gUser = result.user;

      if (!gUser) {
        throw new Error('No user returned from Google sign-in');
      }

      const userEmail = gUser.email;
      if (!userEmail) {
        throw new Error('No email address associated with this Google account.');
      }
      const photo = gUser.photoURL || gUser.photoUrl;
      const displayName = gUser.displayName || gUser.name || 'User';

      let scientist = await db.scientists.where('googleEmail').equals(userEmail).first();
      if (!scientist) {
        scientist = await db.scientists.where('email').equals(userEmail).first();
      }
      if (!scientist) {
        scientist = await db.scientists.where('username').equals(userEmail).first();
      }

      if (!scientist || !scientist.completedProfile) {
        return {
          needsCompletion: true,
          googleData: {
            email: userEmail,
            name: displayName,
            avatar: photo || null
          }
        };
      }

      if (scientist.accountStatus === 'pending') {
        throw new Error('Your account is pending approval by an administrator.');
      }

      const userData = {
        id: scientist.id,
        username: scientist.username,
        name: scientist.name,
        role: scientist.role || 'student',
        avatar: scientist.avatar
      };

      setUser(userData);
      localStorage.setItem('ft_userId', scientist.id);
      sessionStorage.setItem('ft_userId', scientist.id);

      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (authErr) {
        console.warn('Anonymous login failed:', authErr.message);
      }

      return userData;
    } catch (err) {
      console.error('Google login failed:', err);
      throw err;
    }
  };

  const completeGoogleRegistration = async (googleData, extraData) => {
    // googleData: { email, name, avatar }
    // extraData: { username, email (university), name, department, universityId, title, role, password }
    const universityEmail = extraData.email.trim();
    if (universityEmail.toLowerCase() === googleData.email.toLowerCase()) {
      throw new Error('University email must be different from your Google account email');
    }

    const salt = await bcrypt.genSalt(4);
    const hash = await bcrypt.hash(extraData.password, salt);

    // Check if there is an account pre-created with their Google email
    const existingEmail = await db.scientists.where('email').equals(googleData.email).first();

    // Check if the chosen username is taken
    const existingUser = await db.scientists.where('username').equals(extraData.username.trim()).first();
    if (existingUser && (!existingEmail || existingUser.id !== existingEmail.id)) {
      throw new Error('Username is already taken');
    }

    // Check if the university email they entered is taken by someone else
    if (universityEmail) {
      const existingUnivEmail = await db.scientists.where('email').equals(universityEmail).first();
      if (existingUnivEmail && (!existingEmail || existingUnivEmail.id !== existingEmail.id)) {
        throw new Error('University email is already registered');
      }
    }

    // Determine the role (preserve pre-assigned database role, default to master for director)
    let role = extraData.role || 'student';
    if (googleData.email === 'abdullah.amr.makky@gmail.com') {
      role = 'master';
    } else if (existingEmail && existingEmail.role) {
      role = existingEmail.role;
    }

    const isSupervisor = role === 'trainer' || role === 'faculty';
    const generatedId = (isSupervisor ? 'SV-' : 'ST-') + Math.floor(1000 + Math.random() * 9000);

    let scientistId;
    if (existingEmail) {
      // Update the pre-created account (e.g. Master or Supervisor pre-assigned by Admin)
      await db.scientists.update(existingEmail.id, {
        username: extraData.username.trim(),
        email: universityEmail,
        googleEmail: googleData.email,
        passwordHash: hash,
        name: extraData.name.trim() || googleData.name,
        avatar: googleData.avatar || existingEmail.avatar || null,
        department: extraData.department,
        universityId: isSupervisor ? '' : (extraData.universityId ? extraData.universityId.trim() : ''),
        title: isSupervisor ? (extraData.title ? extraData.title.trim() : 'Supervisor') : '',
        role: role,
        accountStatus: 'active',
        completedProfile: true,
        updatedAt: new Date().toISOString()
      });
      scientistId = existingEmail.id;
    } else {
      // Create new account
      scientistId = await db.scientists.add({
        username: extraData.username.trim(),
        email: universityEmail,
        googleEmail: googleData.email,
        passwordHash: hash,
        name: extraData.name.trim() || googleData.name,
        avatar: googleData.avatar || null,
        department: extraData.department,
        universityId: isSupervisor ? '' : (extraData.universityId ? extraData.universityId.trim() : ''),
        title: isSupervisor ? (extraData.title ? extraData.title.trim() : 'Supervisor') : '',
        role: role,
        accountStatus: 'active',
        employeeId: generatedId,
        university: 'Alamein International University',
        faculty: 'Faculty of Science',
        profileViews: 0,
        completedProfile: true,
        createdAt: new Date().toISOString()
      });
    }

    const scientist = await db.scientists.get(scientistId);
    const userData = {
      id: scientist.id,
      username: scientist.username,
      name: scientist.name,
      role: scientist.role || 'student',
      avatar: scientist.avatar
    };

    setUser(userData);
    localStorage.setItem('ft_userId', scientist.id);
    sessionStorage.setItem('ft_userId', scientist.id);
    return userData;
  };

  const logout = async () => {
    setUser(null);
    localStorage.removeItem('ft_userId');
    sessionStorage.removeItem('ft_userId');
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, loginWithGoogle, completeGoogleRegistration, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
export default AuthContext;
