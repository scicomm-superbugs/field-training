import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { db } from './db';
import { ArrowLeft, Clock, MapPin, Users, GraduationCap, User, Building2, XCircle, Calendar, AlertTriangle } from 'lucide-react';
import { getWaveDates, areDatesOverlapping, getAlternativeWaves } from './ftConflictUtils';

export default function FTPlaceDetails() {
  const { placeId } = useParams();
  const navigate = useNavigate();
  const { places, registrations, meDoc, userRole, settings } = useOutletContext();

  const [place, setPlace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null);
  const [trainerDocs, setTrainerDocs] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedWaveId, setSelectedWaveId] = useState('');
  const [confirmDeleteRegId, setConfirmDeleteRegId] = useState(null);

  const [editingRegId, setEditingRegId] = useState(null);
  const [paymentReceipt, setPaymentReceipt] = useState('');
  const [receiptInputKey, setReceiptInputKey] = useState(0);
  const [paymentShake, setPaymentShake] = useState(false);
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [changeProgramId, setChangeProgramId] = useState('');
  const [changeWaveId, setChangeWaveId] = useState('');
  const [conflictModal, setConflictModal] = useState(null);

  const userId = localStorage.getItem('ft_userId') || sessionStorage.getItem('ft_userId');

  const isStaff = userRole === 'admin' || userRole === 'master' || userRole === 'trainer' || userRole === 'faculty';

  // Load place
  useEffect(() => {
    if (places && registrations) {
      const found = places.find(p => p.id === placeId);
      if (found) {
        if (!isStaff && found.isVisible === false) {
          const isRegistered = registrations.some(r => r.placeId === placeId && r.studentId === userId);
          if (!isRegistered) {
            setPlace(null);
            setLoading(false);
            return;
          }
        }
        setPlace(found);
      } else {
        setPlace(null);
      }
      setLoading(false);
    }
  }, [places, registrations, placeId, userId, isStaff]);

  // Load trainer info
  useEffect(() => {
    (async () => {
      const ids = place?.trainerIds || (place?.trainerId ? [place.trainerId] : []);
      if (ids.length > 0) {
        const docs = [];
        for (const id of ids) {
          const t = await db.scientists.get(id);
          if (t) docs.push(t);
        }
        setTrainerDocs(docs);
      } else {
        setTrainerDocs([]);
      }
    })();
  }, [place?.trainerIds, place?.trainerId]);

  const myRegistrations = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(r => r.placeId === placeId && r.studentId === userId);
  }, [registrations, placeId, userId]);

  const isAlreadyRegisteredFor = (programId, waveId) => {
    return myRegistrations.some(r => 
      (r.programId || null) === (programId || null) && 
      (r.waveId || null) === (waveId || null) &&
      r.status !== 'failed'
    );
  };

  const regCount = useMemo(() => {
    if (!registrations) return 0;
    return registrations.filter(r => r.placeId === placeId && r.status !== 'failed' && !r.isTest).length;
  }, [registrations, placeId]);

  const waveStats = useMemo(() => {
    if (!place || !registrations) return {};
    const stats = {};
    if (place.hasPrograms && place.programs) {
      place.programs.forEach(p => {
        if (p.waves) {
          p.waves.forEach(w => {
            stats[w.id] = registrations.filter(
              r => r.placeId === placeId && r.waveId === w.id && r.status !== 'failed' && !r.isTest
            ).length;
          });
        }
      });
    } else if (place.waves) {
      place.waves.forEach(w => {
        stats[w.id] = registrations.filter(
          r => r.placeId === placeId && r.waveId === w.id && r.status !== 'failed' && !r.isTest
        ).length;
      });
    }
    return stats;
  }, [place, registrations, placeId]);

  const totalCapacity = useMemo(() => {
    if (!place) return 0;
    if (place.hasPrograms && place.programs) {
      return place.programs.reduce((acc, p) => {
        if (p.waves && p.waves.length > 0) {
          return acc + p.waves.reduce((sum, w) => sum + (parseInt(w.capacity) || 0), 0);
        }
        return acc + (parseInt(p.capacity) || 0);
      }, 0);
    }
    if (place.waves && place.waves.length > 0) {
      return place.waves.reduce((sum, w) => sum + (parseInt(w.capacity) || 0), 0);
    }
    return parseInt(place.capacity) || 0;
  }, [place]);

  const remainingSpots = useMemo(() => {
    if (!place) return 0;
    let remaining = 0;
    const now = new Date();
    const allRegs = registrations ? registrations.filter(r => r.placeId === placeId && r.status !== 'failed' && !r.isTest) : [];
    
    if (place.hasPrograms && place.programs) {
      place.programs.forEach(prog => {
        const progRegs = allRegs.filter(r => r.programId === prog.id);
        if (prog.waves && prog.waves.length > 0) {
          prog.waves.forEach(w => {
            const isPast = w.deadline ? new Date(w.deadline) < now : false;
            if (!isPast) {
              const wCap = parseInt(w.capacity) || 0;
              const waveRegsCount = progRegs.filter(r => r.waveId === w.id).length;
              remaining += Math.max(0, wCap - waveRegsCount);
            }
          });
        }
      });
    } else if (place.waves && place.waves.length > 0) {
      place.waves.forEach(w => {
        const isPast = w.deadline ? new Date(w.deadline) < now : false;
        if (!isPast) {
          const wCap = parseInt(w.capacity) || 0;
          const waveRegsCount = allRegs.filter(r => r.waveId === w.id).length;
          remaining += Math.max(0, wCap - waveRegsCount);
        }
      });
    }
    return remaining;
  }, [place, registrations, placeId]);

  const isFull = useMemo(() => {
    if (place?.hasPrograms && place.programs && selectedProgramId) {
      const chosenProgram = place.programs.find(p => p.id === selectedProgramId);
      if (chosenProgram?.waves && chosenProgram.waves.length > 0) {
        return chosenProgram.waves.every(w => {
          const taken = waveStats[w.id] || 0;
          return taken >= (w.capacity || 0);
        });
      }
      const totalRegs = registrations.filter(r => r.placeId === placeId && r.programId === selectedProgramId && r.status !== 'failed' && !r.isTest).length;
      return chosenProgram?.capacity ? totalRegs >= chosenProgram.capacity : false;
    }

    if (place?.waves && place.waves.length > 0) {
      return place.waves.every(w => {
        const taken = waveStats[w.id] || 0;
        return taken >= (w.capacity || 0);
      });
    }
    return totalCapacity ? regCount >= totalCapacity : false;
  }, [place, regCount, waveStats, selectedProgramId, registrations, placeId, totalCapacity]);

  const settingsDoc = settings?.find(s => s.id === 'global');
  const allowSelfRegister = settingsDoc?.allowSelfRegister !== false;

  const isPastDeadline = useMemo(() => {
    if (!place || !place.registrationDeadline) return false;
    return new Date(place.registrationDeadline) < new Date();
  }, [place]);

  const selectedWave = useMemo(() => {
    if (!place) return null;
    if (place.hasPrograms && selectedProgramId) {
      const chosenProgram = place.programs.find(p => p.id === selectedProgramId);
      return chosenProgram?.waves?.find(w => w.id === selectedWaveId);
    }
    return place.waves?.find(w => w.id === selectedWaveId);
  }, [place, selectedProgramId, selectedWaveId]);

  const selectedProgram = useMemo(() => {
    if (!place || !place.hasPrograms || !selectedProgramId) return null;
    return place.programs.find(p => p.id === selectedProgramId);
  }, [place, selectedProgramId]);

  const paymentRequired = useMemo(() => {
    if (!place) return false;
    if (selectedWave && selectedWave.payToRegister) return true;
    if (selectedProgram && selectedProgram.payToRegister) return true;
    if (place.payToRegister) return true;
    return false;
  }, [place, selectedProgram, selectedWave]);

  const activePaymentLink = useMemo(() => {
    if (!place) return '';
    if (selectedWave && selectedWave.payToRegister && selectedWave.paymentLink) return selectedWave.paymentLink;
    if (selectedProgram && selectedProgram.payToRegister && selectedProgram.paymentLink) return selectedProgram.paymentLink;
    if (place.payToRegister && place.paymentLink) return place.paymentLink;
    return '';
  }, [place, selectedProgram, selectedWave]);

  const needsApproval = useMemo(() => {
    if (!place) return false;
    const isLocked = !allowSelfRegister;
    const isHidden = place.isVisible === false;
    const isPlaceFull = isFull;
    return isLocked || isHidden || isPlaceFull || isPastDeadline;
  }, [place, allowSelfRegister, isFull, isPastDeadline]);

  const displayHours = useMemo(() => {
    if (myRegistrations && myRegistrations.length > 0) {
      return myRegistrations.reduce((acc, r) => acc + (r.creditHours || 0), 0);
    }
    if (place?.hasPrograms && place.programs && selectedProgramId) {
      const prog = place.programs.find(p => p.id === selectedProgramId);
      if (prog) return parseInt(prog.creditHours) || 0;
    }
    return place?.creditHours || 0;
  }, [place, myRegistrations, selectedProgramId]);

  const placeRegs = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(r => r.placeId === placeId && !r.isTest);
  }, [registrations, placeId]);

  const handleRemoveStudent = async (regId) => {
    if (!window.confirm('Are you sure you want to remove this student from this place?')) return;
    try {
      await db.ft_registrations.delete(regId);
      setToast({ type: 'success', msg: 'Student removed successfully!' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to remove student: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const checkDateConflicts = (chosenWave) => {
    if (!chosenWave || !places || !registrations || !userId) return null;
    const targetDates = getWaveDates(chosenWave);
    if (!targetDates) return null;

    const myActiveRegs = registrations.filter(r =>
      r.studentId === userId &&
      (r.status === 'active' || r.status === 'pending' || r.status === 'completed')
    );

    for (const reg of myActiveRegs) {
      const regPlace = places.find(p => p.id === reg.placeId);
      if (!regPlace) continue;
      let regWave = null;
      if (regPlace.hasPrograms && regPlace.programs) {
        const prog = regPlace.programs.find(p => p.id === reg.programId);
        if (prog && prog.waves) regWave = prog.waves.find(w => w.id === reg.waveId);
      } else if (regPlace.waves) {
        regWave = regPlace.waves.find(w => w.id === reg.waveId);
      }
      if (!regWave) continue;
      const regDates = getWaveDates(regWave);
      if (!regDates) continue;
      if (areDatesOverlapping(targetDates.start, targetDates.end, regDates.start, regDates.end)) {
        return {
          conflictingReg: reg,
          conflictingPlace: regPlace,
          conflictingWave: regWave,
          conflictDates: regDates,
          targetDates
        };
      }
    }
    return null;
  };

  const handleRegister = async () => {
    if (registering) return;

    if (isAlreadyRegisteredFor(selectedProgramId, selectedWaveId)) {
      setToast({ type: 'error', msg: 'You are already registered for this program and wave combination.' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    const chosenProgram = place?.hasPrograms ? place.programs.find(p => p.id === selectedProgramId) : null;
    const chosenWave = place?.hasPrograms 
      ? chosenProgram?.waves?.find(w => w.id === selectedWaveId) 
      : place?.waves?.find(w => w.id === selectedWaveId);

    const isWavePastDeadline = chosenWave?.deadline ? new Date(chosenWave.deadline) < new Date() : false;
    if (isWavePastDeadline) {
      setToast({ type: 'error', msg: 'The registration deadline for this wave has passed.' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    // Date conflict check
    if (chosenWave) {
      const conflict = checkDateConflicts(chosenWave);
      if (conflict) {
        const alternatives = getAlternativeWaves(place, selectedProgramId, registrations, places, userId);
        setConflictModal({
          targetWave: chosenWave,
          targetPlace: place,
          ...conflict,
          alternatives: alternatives.filter(a => a.wave.id !== chosenWave.id)
        });
        return;
      }
    }

    const paymentRequired = chosenWave?.payToRegister || chosenProgram?.payToRegister || place?.payToRegister || false;
    if (paymentRequired && !paymentReceipt) {
      setToast({ type: 'error', msg: 'Please upload your payment receipt to complete registration.' });
      const el = document.getElementById('payment-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPaymentShake(true);
      setTimeout(() => setPaymentShake(false), 800);
      setTimeout(() => setToast(null), 3000);
      return;
    }

    if (place?.hasPrograms) {
      if (!selectedProgramId) {
        setToast({ type: 'error', msg: 'Please select a training program.' });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      if (chosenProgram?.waves && chosenProgram.waves.length > 0 && !selectedWaveId) {
        setToast({ type: 'error', msg: 'Please select a training wave/duration for your selected program.' });
        setTimeout(() => setToast(null), 3000);
        return;
      }

      setRegistering(true);

      try {
        await db.ft_registrations.add({
          studentId: userId,
          placeId: placeId,
          placeName: place.name,
          programId: selectedProgramId,
          programName: chosenProgram.name,
          creditHours: parseInt(chosenProgram.creditHours) || place.creditHours || 0,
          status: 'pending',
          registeredAt: new Date().toISOString(),
          studentName: meDoc?.name || '',
          studentDepartment: meDoc?.department || '',
          studentUniversityId: meDoc?.universityId || '',
          studentPhone: meDoc?.phone || '',
          waveId: selectedWaveId || null,
          waveName: chosenWave ? `${chosenWave.name} (${chosenWave.duration})` : null,
          paymentRequired: paymentRequired,
          paymentReceipt: paymentRequired ? paymentReceipt : null
        });

        // Create admin notification
        await db.ft_notifications.add({
          title: 'New Registration Request',
          message: `${meDoc?.name || 'A student'} requested to register for ${place.name}${chosenWave ? ` (${chosenWave.name})` : ''}`,
          type: 'registration_request',
          status: 'unread',
          targetRoles: ['admin', 'master', 'faculty'],
          targetUserId: null,
          studentId: userId,
          placeId: placeId,
          waveId: selectedWaveId || null,
          createdAt: new Date().toISOString(),
          link: '/manage-places'
        });

        setToast({ type: 'success', msg: 'Successfully registered! Your registration is pending approval.' });
        setSelectedProgramId('');
        setSelectedWaveId('');
        setPaymentReceipt('');
      } catch (err) {
        setToast({ type: 'error', msg: 'Registration failed: ' + err.message });
      }
      setRegistering(false);
      setTimeout(() => setToast(null), 4000);
      return;
    }

    if (place?.waves && place.waves.length > 0 && !selectedWaveId) {
      setToast({ type: 'error', msg: 'Please select a training wave/duration.' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    setRegistering(true);

    try {
      await db.ft_registrations.add({
        studentId: userId,
        placeId: placeId,
        placeName: place.name,
        creditHours: place.creditHours || 0,
        status: 'pending',
        registeredAt: new Date().toISOString(),
        studentName: meDoc?.name || '',
        studentDepartment: meDoc?.department || '',
        studentUniversityId: meDoc?.universityId || '',
        studentPhone: meDoc?.phone || '',
        waveId: selectedWaveId || null,
        waveName: chosenWave ? `${chosenWave.name} (${chosenWave.duration})` : null,
        paymentRequired: paymentRequired,
        paymentReceipt: paymentRequired ? paymentReceipt : null
      });

      // Create admin notification
      await db.ft_notifications.add({
        title: 'New Registration Request',
        message: `${meDoc?.name || 'A student'} requested to register for ${place.name}${chosenWave ? ` (${chosenWave.name})` : ''}`,
        type: 'registration_request',
        status: 'unread',
        targetRoles: ['admin', 'master', 'faculty'],
        targetUserId: null,
        studentId: userId,
        placeId: placeId,
        waveId: selectedWaveId || null,
        createdAt: new Date().toISOString(),
        link: '/manage-places'
      });

      setToast({ type: 'success', msg: 'Successfully registered! Your registration is pending approval.' });
      setSelectedWaveId('');
      setPaymentReceipt('');
    } catch (err) {
      setToast({ type: 'error', msg: 'Registration failed: ' + err.message });
    }
    setRegistering(false);
    setTimeout(() => setToast(null), 4000);
  };

  const handleUnregister = async (targetReg) => {
    if (!targetReg) return;
    if (targetReg.status === 'completed') {
      setToast({ type: 'error', msg: 'Cannot unregister from a completed training.' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (needsApproval) {
      try {
        await db.ft_registrations.update(targetReg.id, {
          changeRequest: {
            type: 'cancel',
            requestedAt: new Date().toISOString()
          }
        });
        
        // Create admin notification
        await db.ft_notifications.add({
          title: 'Cancellation Request',
          message: `${meDoc?.name || 'A student'} requested to cancel registration for ${place.name}`,
          type: 'cancellation_request',
          status: 'unread',
          targetRoles: ['admin', 'master', 'faculty'],
          targetUserId: null,
          studentId: userId,
          placeId: placeId,
          createdAt: new Date().toISOString(),
          link: '/manage-places'
        });

        setToast({ type: 'success', msg: 'Cancellation request submitted for admin approval.' });
      } catch (err) {
        setToast({ type: 'error', msg: 'Failed to request cancellation: ' + err.message });
      }
    } else {
      try {
        await db.ft_registrations.delete(targetReg.id);
        setToast({ type: 'success', msg: 'Registration cancelled successfully.' });
      } catch (err) {
        setToast({ type: 'error', msg: 'Failed to cancel registration: ' + err.message });
      }
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmitChangeRequest = async (targetReg) => {
    if (!targetReg) return;
    
    let requestedProgName = null;
    let requestedWaveName = null;
    let chosenProg = null;
    let chosenWave = null;
    
    if (place.hasPrograms) {
      if (!changeProgramId) {
        setToast({ type: 'error', msg: 'Please select a program for the change.' });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      chosenProg = place.programs.find(p => p.id === changeProgramId);
      requestedProgName = chosenProg?.name;
      
      if (chosenProg?.waves && chosenProg.waves.length > 0) {
        if (!changeWaveId) {
          setToast({ type: 'error', msg: 'Please select a wave for the change.' });
          setTimeout(() => setToast(null), 3000);
          return;
        }
        chosenWave = chosenProg.waves.find(wave => wave.id === changeWaveId);
        requestedWaveName = chosenWave ? `${chosenWave.name} (${chosenWave.duration})` : null;
      }
    } else if (place.waves && place.waves.length > 0) {
      if (!changeWaveId) {
        setToast({ type: 'error', msg: 'Please select a wave for the change.' });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      chosenWave = place.waves.find(wave => wave.id === changeWaveId);
      requestedWaveName = chosenWave ? `${chosenWave.name} (${chosenWave.duration})` : null;
    }

    // Check target wave capacity specifically
    let isDestFull = false;
    if (chosenWave) {
      const taken = waveStats[chosenWave.id] || 0;
      isDestFull = taken >= (chosenWave.capacity || 0);
    } else if (chosenProg) {
      const totalRegs = registrations.filter(r => r.placeId === placeId && r.programId === chosenProg.id && r.status !== 'failed' && !r.isTest).length;
      isDestFull = chosenProg.capacity ? totalRegs >= chosenProg.capacity : false;
    }

    const requiresApproval = needsApproval || isDestFull;

    try {
      if (requiresApproval) {
        await db.ft_registrations.update(targetReg.id, {
          changeRequest: {
            type: 'change',
            requestedAt: new Date().toISOString(),
            programId: changeProgramId || null,
            programName: requestedProgName || null,
            waveId: changeWaveId || null,
            waveName: requestedWaveName || null
          }
        });

        // Create admin notification
        await db.ft_notifications.add({
          title: 'Change Request',
          message: `${meDoc?.name || 'A student'} requested to change registration for ${place.name}`,
          type: 'change_request',
          status: 'unread',
          targetRoles: ['admin', 'master', 'faculty'],
          targetUserId: null,
          studentId: userId,
          placeId: placeId,
          createdAt: new Date().toISOString(),
          link: '/manage-places'
        });

        setToast({ type: 'success', msg: 'Change request submitted for admin approval.' });
      } else {
        await db.ft_registrations.update(targetReg.id, {
          programId: changeProgramId || null,
          programName: requestedProgName || null,
          waveId: changeWaveId || null,
          waveName: requestedWaveName || null,
          updatedAt: new Date().toISOString()
        });
        setToast({ type: 'success', msg: 'Registration updated successfully.' });
      }
      setEditingRegId(null);
    } catch (err) {
      setToast({ type: 'error', msg: 'Action failed: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImporting(true);
    setToast({ type: 'info', msg: 'Reading CSV file...' });

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      try {
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.length < 2) {
          setToast({ type: 'error', msg: 'CSV file is empty or missing headers.' });
          setImporting(false);
          return;
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["']/g, ''));
        const idIdx = headers.findIndex(h => h.includes('id') || h.includes('number'));
        const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('student'));
        const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('mail'));
        const waveIdx = headers.findIndex(h => h.includes('wave') || h.includes('duration'));
        const programIdx = headers.findIndex(h => h.includes('program'));

        const hasMultiplePrograms = place.hasPrograms && place.programs && place.programs.length > 1;

        if (idIdx === -1) {
          setToast({ type: 'error', msg: 'CSV must contain a column for "University ID" (or "ID" / "Number").' });
          setImporting(false);
          return;
        }

        if (waveIdx === -1) {
          setToast({ type: 'error', msg: 'CSV must contain a column for "Wave" (or "Duration").' });
          setImporting(false);
          return;
        }

        if (hasMultiplePrograms && programIdx === -1) {
          setToast({ type: 'error', msg: 'CSV must contain a column for "Program" because this place offers multiple programs.' });
          setImporting(false);
          return;
        }

        setToast({ type: 'info', msg: 'Processing import...' });
        let imported = 0;
        let errors = 0;

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim().replace(/["']/g, ''));
          if (cols.length < 1) continue;

          const rowId = cols[idIdx];
          const rowName = nameIdx !== -1 ? (cols[nameIdx] || '') : '';
          const rowEmail = emailIdx !== -1 ? (cols[emailIdx] || '') : '';
          const rowWaveName = waveIdx !== -1 ? (cols[waveIdx] || '') : '';
          const rowProgramName = (hasMultiplePrograms && programIdx !== -1) ? (cols[programIdx] || '') : '';

          let matchedWave = null;
          let matchedProgram = null;

          if (hasMultiplePrograms) {
            if (!rowProgramName) {
              errors++;
              continue;
            }
            matchedProgram = place.programs.find(p => 
              rowProgramName.toLowerCase().includes(p.name.toLowerCase()) ||
              p.name.toLowerCase().includes(rowProgramName.toLowerCase())
            );
            if (matchedProgram && rowWaveName && matchedProgram.waves) {
              matchedWave = matchedProgram.waves.find(w => 
                rowWaveName.toLowerCase().includes(w.name.toLowerCase()) ||
                w.name.toLowerCase().includes(rowWaveName.toLowerCase())
              );
            }
          } else {
            // Fallback for single program or direct waves
            if (rowWaveName) {
              if (place.hasPrograms && place.programs && place.programs[0]) {
                matchedProgram = place.programs[0];
                if (matchedProgram.waves) {
                  matchedWave = matchedProgram.waves.find(w => 
                    rowWaveName.toLowerCase().includes(w.name.toLowerCase()) ||
                    w.name.toLowerCase().includes(rowWaveName.toLowerCase())
                  );
                }
              } else if (place.waves) {
                matchedWave = place.waves.find(w => 
                  rowWaveName.toLowerCase().includes(w.name.toLowerCase()) ||
                  w.name.toLowerCase().includes(rowWaveName.toLowerCase())
                );
              }
            }
          }

          if (!rowId || !rowWaveName || !matchedWave) {
            errors++;
            continue;
          }

          // Check if already registered
          const existingReg = registrations.find(r => 
            r.placeId === placeId && 
            (r.studentUniversityId === rowId || (rowEmail && r.studentEmail?.toLowerCase() === rowEmail.toLowerCase()))
          );

          if (existingReg) {
            const updatedWaveName = `${matchedWave.name} (${matchedWave.duration})`;
            if (existingReg.waveId !== matchedWave.id || existingReg.waveName !== updatedWaveName || existingReg.programId !== (matchedProgram?.id || null)) {
              await db.ft_registrations.update(existingReg.id, {
                programId: matchedProgram?.id || null,
                programName: matchedProgram?.name || null,
                waveId: matchedWave.id,
                waveName: updatedWaveName
              });
              imported++;
            }
            continue;
          }

          let scientist = await db.scientists.where('universityId').equals(rowId).first();
          if (!scientist && rowEmail) {
            scientist = await db.scientists.where('email').equals(rowEmail).first();
          }

          const hours = matchedProgram ? (parseInt(matchedProgram.creditHours) || 0) : (place.creditHours || 0);

          if (scientist) {
            await db.ft_registrations.add({
              studentId: scientist.id,
              placeId: placeId,
              placeName: place.name,
              programId: matchedProgram?.id || null,
              programName: matchedProgram?.name || null,
              creditHours: hours,
              status: 'active',
              registeredAt: new Date().toISOString(),
              studentName: scientist.name || rowName,
              studentDepartment: scientist.department || '',
              studentUniversityId: scientist.universityId || rowId,
              studentEmail: scientist.email || rowEmail,
              waveId: matchedWave.id,
              waveName: `${matchedWave.name} (${matchedWave.duration})`
            });
          } else {
            await db.ft_registrations.add({
              studentId: null,
              placeId: placeId,
              placeName: place.name,
              programId: matchedProgram?.id || null,
              programName: matchedProgram?.name || null,
              creditHours: hours,
              status: 'active',
              registeredAt: new Date().toISOString(),
              studentName: rowName,
              studentDepartment: '',
              studentUniversityId: rowId,
              studentEmail: rowEmail,
              waveId: matchedWave.id,
              waveName: `${matchedWave.name} (${matchedWave.duration})`
            });
          }
          imported++;
        }

        setToast({ type: 'success', msg: `Successfully imported ${imported} students! (${errors} errors)` });
      } catch (err) {
        setToast({ type: 'error', msg: 'Import failed: ' + err.message });
      }
      setImporting(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (loading) {
    return (
      <div>
        <div className="ft-skeleton" style={{ height: '300px', borderRadius: 'var(--ft-radius-xl)', marginBottom: '2rem' }} />
        <div className="ft-skeleton" style={{ height: '24px', width: '40%', marginBottom: '1rem' }} />
        <div className="ft-skeleton" style={{ height: '16px', width: '100%', marginBottom: '0.5rem' }} />
        <div className="ft-skeleton" style={{ height: '16px', width: '80%' }} />
      </div>
    );
  }

  if (!place) {
    return (
      <div className="ft-empty">
        <div className="ft-empty-icon">🔍</div>
        <div className="ft-empty-title">Place Not Found</div>
        <div className="ft-empty-text">This training place doesn't exist or has been removed.</div>
        <button className="ft-btn ft-btn-primary" onClick={() => navigate('/')}>← Back to Places</button>
      </div>
    );
  }

  return (
    <>
      <div className="ft-animate-in">
        {/* Back button */}
        <button className="ft-btn ft-btn-ghost" onClick={() => navigate('/')} style={{ marginBottom: '1rem' }}>
          <ArrowLeft size={18} /> Back to Places
        </button>

        {/* Hero Image */}
        <div className="ft-place-hero">
          {place.image ? (
            <img src={place.image} alt={place.name} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #0d9488, #0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '5rem' }}>
              🏢
            </div>
          )}
          <div className="ft-place-hero-overlay">
            <div>
              <div className="ft-place-hero-title">{place.name}</div>
              {place.department && (
                <span style={{ display: 'inline-block', marginTop: '0.5rem', background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)', color: 'white', padding: '0.3rem 0.85rem', borderRadius: 'var(--ft-radius-full)', fontSize: '0.82rem', fontWeight: 600 }}>
                  {place.department}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Content Grid */}
        <div className="ft-place-detail-grid">
          {/* Left — Description & Info */}
          <div>
            <div className="ft-card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>About This Training Place</h3>
              <p style={{ color: 'var(--ft-text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {place.description || 'No description has been provided for this training place.'}
              </p>
            </div>



            {place.thesis && (
              <div className="ft-card" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>📄 Training Topics</h3>
                <p style={{ color: 'var(--ft-text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {place.thesis}
                </p>
              </div>
            )}

            {place.requirements && (
              <div className="ft-card">
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>📋 Requirements</h3>
                <p style={{ color: 'var(--ft-text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {place.requirements}
                </p>
              </div>
            )}


          </div>

          {/* Right — Info card (sticky) */}
          <div className="ft-place-detail-sticky">
            <div className="ft-card">
              {/* Credit Hours */}
              <div style={{ textAlign: 'center', padding: '1rem 0 1.5rem', borderBottom: '1px solid var(--ft-border-light)' }}>
                <div style={{ fontSize: '3rem', fontFamily: "'Outfit', sans-serif", fontWeight: 800, color: 'var(--ft-primary)' }}>
                  {place.creditHours || 0}
                </div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--ft-text-muted)' }}>Credit Hours</div>
              </div>

              {/* Info rows */}
              <div style={{ padding: '0.5rem 0' }}>
                <div className="ft-place-info-row">
                  <MapPin size={16} style={{ color: 'var(--ft-text-muted)' }} />
                  <span className="ft-place-info-label">Department</span>
                  <span className="ft-place-info-value">{place.department || '—'}</span>
                </div>
                {totalCapacity > 0 && (
                  <div className="ft-place-info-row">
                    <Building2 size={16} style={{ color: 'var(--ft-text-muted)' }} />
                    <span className="ft-place-info-label">Capacity</span>
                    <span className="ft-place-info-value" style={{ color: remainingSpots > 0 ? 'inherit' : 'var(--ft-danger)', fontWeight: remainingSpots > 0 ? 'normal' : 700 }}>
                      {remainingSpots}/{totalCapacity} spots
                    </span>
                  </div>
                )}
                {trainerDocs.length > 0 && (
                  <div className="ft-place-info-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <User size={16} style={{ color: 'var(--ft-text-muted)', marginTop: '0.2rem' }} />
                    <span className="ft-place-info-label">Trainer{trainerDocs.length > 1 ? 's' : ''}</span>
                    <span className="ft-place-info-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem', marginLeft: 'auto', textAlign: 'right' }}>
                      {trainerDocs.map(t => (
                        <span key={t.id} style={{ whiteSpace: 'nowrap' }}>{t.name}</span>
                      ))}
                    </span>
                  </div>
                )}
                {place.registrationDeadline && (
                  <div className="ft-place-info-row">
                    <Calendar size={16} style={{ color: 'var(--ft-text-muted)' }} />
                    <span className="ft-place-info-label">Deadline</span>
                    <span className="ft-place-info-value" style={isPastDeadline ? { color: 'var(--ft-danger)', fontWeight: 700 } : { color: 'var(--ft-primary)', fontWeight: 700 }}>
                      {new Date(place.registrationDeadline).toLocaleString()} {isPastDeadline && ' (Closed)'}
                    </span>
                  </div>
                )}
              </div>

              {/* Current Student Registrations (if any) */}
              {myRegistrations && myRegistrations.length > 0 && (
                <div style={{ padding: '1rem 0 0', borderTop: '1px solid var(--ft-border-light)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--ft-text)', marginBottom: '0.25rem' }}>
                    📋 Your Registered Program(s) / Wave(s):
                  </div>
                  {myRegistrations.map((reg) => {
                    const isEditing = editingRegId === reg.id;
                    return (
                      <div key={reg.id} style={{ border: '1.5px solid var(--ft-border)', borderRadius: 'var(--ft-radius)', padding: '1rem', background: 'var(--ft-bg-card)', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--ft-text)' }}>
                            🎓 {reg.programName || place.name}
                          </span>
                          <span className={`ft-badge ft-badge-${reg.status}`} style={{ fontSize: '0.74rem', padding: '0.15rem 0.5rem', height: 'auto' }}>
                            {reg.status === 'pending' && '🟡 Pending'}
                            {reg.status === 'active' && '🔵 In Training'}
                            {reg.status === 'completed' && '✅ Completed'}
                            {reg.status === 'failed' && '🔴 Failed'}
                          </span>
                        </div>
                        
                        {reg.waveName && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-secondary)' }}>
                            Wave: <strong>{reg.waveName}</strong>
                          </div>
                        )}
                        
                        {reg.paymentReceipt ? (
                          <button 
                            onClick={() => {
                              const w = window.open();
                              w.document.write(`<iframe src="${reg.paymentReceipt}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                            }}
                            className="ft-btn ft-btn-secondary ft-btn-sm"
                            style={{ fontSize: '0.75rem', width: 'max-content', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#16a34a', borderColor: 'rgba(22, 163, 74, 0.15)', background: '#dcfce7', padding: '0.25rem 0.5rem', height: 'auto' }}
                          >
                            📄 View Uploaded Receipt
                          </button>
                        ) : reg.paymentRef ? (
                          <div style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '0.25rem 0.5rem', borderRadius: 'var(--ft-radius-sm)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', width: 'fit-content' }}>
                            💰 Paid (Ref: {reg.paymentRef})
                          </div>
                        ) : null}

                        {reg.changeRequest ? (
                          <div style={{ padding: '0.75rem', border: '1px dashed var(--ft-warning)', borderRadius: 'var(--ft-radius-sm)', background: 'rgba(217, 119, 6, 0.04)', marginTop: '0.25rem' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--ft-warning-text)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              ⏳ Request Pending
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--ft-text-secondary)', marginTop: '0.2rem', marginBottom: '0.5rem' }}>
                              {reg.changeRequest.type === 'cancel' 
                                ? 'Requested to totally cancel registration.' 
                                : `Requested change to: ${reg.changeRequest.programName || ''} ${reg.changeRequest.waveName ? `(${reg.changeRequest.waveName})` : ''}`}
                            </div>
                            <button 
                              className="ft-btn ft-btn-secondary ft-btn-sm ft-w-full" 
                              onClick={async () => {
                                try {
                                  await db.ft_registrations.update(reg.id, { changeRequest: null });
                                  setToast({ type: 'info', msg: 'Change request withdrawn.' });
                                } catch(e) {
                                  setToast({ type: 'error', msg: 'Error: ' + e.message });
                                }
                                setTimeout(() => setToast(null), 3000);
                              }}
                              style={{ fontSize: '0.75rem' }}
                            >
                              Withdraw Request
                            </button>
                          </div>
                        ) : (
                          reg.status !== 'completed' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                              {isEditing ? (
                                <div style={{ border: '1.5px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', padding: '0.75rem', background: 'var(--ft-bg-input)' }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--ft-text-secondary)', marginBottom: '0.5rem' }}>Request Change Details:</div>
                                  
                                  {/* Change Program Select */}
                                  {place.hasPrograms && place.programs && place.programs.length > 0 && (
                                    <div style={{ marginBottom: '0.5rem' }}>
                                      <select 
                                        value={changeProgramId} 
                                        onChange={e => {
                                          setChangeProgramId(e.target.value);
                                          setChangeWaveId('');
                                        }}
                                        className="ft-select ft-w-full"
                                        style={{ padding: '0.4rem', fontSize: '0.8rem', marginBottom: '0.5rem' }}
                                      >
                                        <option value="">-- Choose New Program --</option>
                                        {place.programs.map(p => {
                                          const taken = registrations.filter(r => r.placeId === placeId && r.programId === p.id && r.status !== 'failed' && !r.isTest).length;
                                          const progFull = p.capacity ? taken >= p.capacity : false;
                                          return (
                                            <option key={p.id} value={p.id} disabled={progFull}>
                                              {p.name} {progFull ? '(Full)' : ''}
                                            </option>
                                          );
                                        })}
                                      </select>

                                      {/* Program details inside change request */}
                                      {changeProgramId && (() => {
                                        const prog = place.programs.find(p => p.id === changeProgramId);
                                        if (!prog) return null;
                                        return (
                                          <div style={{ 
                                            background: 'var(--ft-bg-card)', 
                                            border: '1px solid var(--ft-border)', 
                                            padding: '0.65rem', 
                                            borderRadius: 'var(--ft-radius-sm)',
                                            marginBottom: '0.5rem',
                                            fontSize: '0.75rem',
                                            color: 'var(--ft-text-secondary)'
                                          }}>
                                            <div style={{ fontWeight: 700, color: 'var(--ft-text)', marginBottom: '0.25rem' }}>
                                              {prog.name}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem' }}>
                                              <span>⏱️ {prog.creditHours}h</span>
                                              <span>👥 {prog.capacity} spots</span>
                                            </div>
                                            {prog.description && <div style={{ fontSize: '0.72rem', whiteSpace: 'pre-wrap' }}>{prog.description}</div>}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  )}

                                  {/* Change Wave Select */}
                                  {(() => {
                                    const progWaves = place.hasPrograms 
                                      ? place.programs.find(p => p.id === changeProgramId)?.waves 
                                      : place.waves;
                                    if (!progWaves || progWaves.length === 0) return null;
                                    return (
                                      <div style={{ marginBottom: '0.5rem' }}>
                                        <select 
                                          value={changeWaveId} 
                                          onChange={e => setChangeWaveId(e.target.value)}
                                          className="ft-select ft-w-full"
                                          style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                        >
                                          <option value="">-- Choose New Wave --</option>
                                          {progWaves.map(w => {
                                            const taken = waveStats[w.id] || 0;
                                            const waveFull = w.capacity ? taken >= w.capacity : false;
                                            return (
                                              <option key={w.id} value={w.id} disabled={waveFull}>
                                                {w.name} ({w.duration}) {waveFull ? '- Full' : ''}
                                              </option>
                                            );
                                          })}
                                        </select>
                                      </div>
                                    );
                                  })()}

                                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                    <button className="ft-btn ft-btn-primary ft-btn-sm" style={{ flex: 1, fontSize: '0.78rem' }} onClick={() => handleSubmitChangeRequest(reg)}>
                                      {needsApproval ? 'Submit Request' : 'Save Changes'}
                                    </button>
                                    <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ flex: 1, fontSize: '0.78rem' }} onClick={() => setEditingRegId(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <button className="ft-btn ft-btn-primary ft-btn-sm" style={{ flex: 1, fontSize: '0.75rem' }} onClick={() => {
                                    setChangeProgramId(reg.programId || '');
                                    setChangeWaveId(reg.waveId || '');
                                    setEditingRegId(reg.id);
                                  }}>
                                    ✏️ Request Change
                                  </button>
                                  <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ flex: 1, fontSize: '0.75rem', color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.15)' }} onClick={() => handleUnregister(reg)}>
                                    ❌ Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {(allowSelfRegister && (place.hasPrograms || !myRegistrations.some(r => r.status !== 'failed'))) ? (
                <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--ft-border-light)', paddingTop: '1rem' }}>
                  {myRegistrations.length > 0 && place.hasPrograms && (
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ft-primary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      🚀 Register for another program:
                    </div>
                  )}
                  
                  {/* Program Selection UI */}
                  {place.hasPrograms && place.programs && place.programs.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ft-text-secondary)', marginBottom: '0.5rem' }}>
                        Select Program:
                      </div>
                      <select 
                        value={selectedProgramId} 
                        onChange={e => {
                          setSelectedProgramId(e.target.value);
                          setSelectedWaveId('');
                        }}
                        className="ft-select ft-w-full"
                        style={{ padding: '0.5rem', borderRadius: 'var(--ft-radius-sm)', border: '1px solid var(--ft-border)', outline: 'none' }}
                      >
                        <option value="">-- Choose Program --</option>
                        {place.programs.map(p => {
                          const isRegisteredForProg = myRegistrations.some(r => r.programId === p.id && r.status !== 'failed');
                          return (
                            <option key={p.id} value={p.id} disabled={isRegisteredForProg}>
                              {p.name} {isRegisteredForProg ? ' (Already Enrolled)' : ''}
                            </option>
                          );
                        })}
                      </select>

                      {/* Selected Program Details */}
                      {selectedProgramId && (() => {
                        const chosenProgram = place.programs.find(p => p.id === selectedProgramId);
                        if (!chosenProgram) return null;
                        return (
                          <div style={{ 
                            background: 'var(--ft-bg-input)', 
                            border: '1.5px solid var(--ft-border)', 
                            padding: '0.85rem', 
                            borderRadius: 'var(--ft-radius-sm)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                            marginTop: '0.5rem'
                          }}>
                            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--ft-text)' }}>
                              {chosenProgram.name}
                            </div>
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--ft-primary)', background: 'var(--ft-primary-bg)', padding: '0.05rem 0.35rem', borderRadius: '4px' }}>
                                ⏱️ {chosenProgram.creditHours} Credit Hours
                              </span>
                              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--ft-text-secondary)', background: 'rgba(0,0,0,0.05)', padding: '0.05rem 0.35rem', borderRadius: '4px' }}>
                                👥 {chosenProgram.capacity} spots
                              </span>
                            </div>
                            {chosenProgram.description && (
                              <p style={{ color: 'var(--ft-text-secondary)', fontSize: '0.78rem', lineHeight: 1.5, margin: '0.25rem 0 0', whiteSpace: 'pre-wrap' }}>
                                {chosenProgram.description}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Waves Selection UI (for place direct waves) */}
                  {place.waves && place.waves.length > 0 && !place.hasPrograms && (
                    <div style={{ padding: '0.5rem 0', borderTop: '1px solid var(--ft-border-light)', borderBottom: '1px solid var(--ft-border-light)', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ft-text-secondary)', marginBottom: '0.75rem' }}>
                        Select Training Wave / Dates:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {place.waves.map(w => {
                          const taken = waveStats[w.id] || 0;
                          const capacity = w.capacity || 0;
                          const isWaveFull = taken >= capacity;
                          const isWavePastDeadline = w.deadline ? new Date(w.deadline) < new Date() : false;
                          const isAlreadyEnrolled = isAlreadyRegisteredFor(null, w.id);
                          const isSelected = selectedWaveId === w.id;
                          const isSelectable = !isWaveFull && !isWavePastDeadline && !isAlreadyEnrolled;
                          return (
                            <div
                              key={w.id}
                              onClick={() => isSelectable && setSelectedWaveId(w.id)}
                              style={{
                                padding: '0.65rem 0.85rem',
                                borderRadius: 'var(--ft-radius-sm)',
                                border: isSelected ? '1.5px solid var(--ft-primary)' : '1px solid var(--ft-border)',
                                background: isSelected ? 'var(--ft-primary-bg)' : (isSelectable ? 'var(--ft-bg-card)' : 'rgba(0,0,0,0.02)'),
                                cursor: isSelectable ? 'pointer' : 'not-allowed',
                                opacity: isSelectable ? 1 : 0.6,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.15rem',
                                transition: 'all 0.2s',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.82rem', color: isSelected ? 'var(--ft-primary)' : 'var(--ft-text)' }}>
                                  {w.name}
                                </span>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isWaveFull || isWavePastDeadline || isAlreadyEnrolled ? 'var(--ft-danger)' : 'var(--ft-success)' }}>
                                  {isWaveFull 
                                    ? 'Full' 
                                    : (isWavePastDeadline ? 'Deadline Passed' : (isAlreadyEnrolled ? 'Already Enrolled' : `${capacity - taken} seats left`))
                                  }
                                </span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--ft-text-secondary)' }}>
                                <span>📅 {w.duration}</span>
                                {w.deadline && (
                                  <span style={isWavePastDeadline ? { color: 'var(--ft-danger)', fontWeight: 600 } : {}}>
                                    ⏰ Registration Deadline: <strong style={{ fontWeight: 600 }}>{new Date(w.deadline).toLocaleString()}</strong>
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Waves Selection UI (for program waves) */}
                  {place.hasPrograms && selectedProgramId && (() => {
                    const chosenProgram = place.programs.find(p => p.id === selectedProgramId);
                    if (!chosenProgram || !chosenProgram.waves || chosenProgram.waves.length === 0) return null;
                    return (
                      <div style={{ padding: '0.5rem 0', borderTop: '1px solid var(--ft-border-light)', borderBottom: '1px solid var(--ft-border-light)', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ft-text-secondary)', marginBottom: '0.75rem' }}>
                          Select Training Wave / Dates:
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {chosenProgram.waves.map(w => {
                            const taken = waveStats[w.id] || 0;
                            const capacity = w.capacity || 0;
                            const isWaveFull = taken >= capacity;
                            const isWavePastDeadline = w.deadline ? new Date(w.deadline) < new Date() : false;
                            const isAlreadyEnrolled = isAlreadyRegisteredFor(selectedProgramId, w.id);
                            const isSelected = selectedWaveId === w.id;
                            const isSelectable = !isWaveFull && !isWavePastDeadline && !isAlreadyEnrolled;
                            return (
                              <div
                                key={w.id}
                                onClick={() => isSelectable && setSelectedWaveId(w.id)}
                                style={{
                                  padding: '0.65rem 0.85rem',
                                  borderRadius: 'var(--ft-radius-sm)',
                                  border: isSelected ? '1.5px solid var(--ft-primary)' : '1px solid var(--ft-border)',
                                  background: isSelected ? 'var(--ft-primary-bg)' : (isSelectable ? 'var(--ft-bg-card)' : 'rgba(0,0,0,0.02)'),
                                  cursor: isSelectable ? 'pointer' : 'not-allowed',
                                  opacity: isSelectable ? 1 : 0.6,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.15rem',
                                  transition: 'all 0.2s',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                                  <span style={{ fontWeight: 700, fontSize: '0.82rem', color: isSelected ? 'var(--ft-primary)' : 'var(--ft-text)' }}>
                                    {w.name}
                                  </span>
                                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isWaveFull || isWavePastDeadline || isAlreadyEnrolled ? 'var(--ft-danger)' : 'var(--ft-success)' }}>
                                    {isWaveFull 
                                      ? 'Full' 
                                      : (isWavePastDeadline ? 'Deadline Passed' : (isAlreadyEnrolled ? 'Already Enrolled' : `${capacity - taken} seats left`))
                                    }
                                  </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--ft-text-secondary)' }}>
                                  <span>📅 {w.duration}</span>
                                  {w.deadline && (
                                    <span style={isWavePastDeadline ? { color: 'var(--ft-danger)', fontWeight: 600 } : {}}>
                                      ⏰ Registration Deadline: <strong style={{ fontWeight: 600 }}>{new Date(w.deadline).toLocaleString()}</strong>
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Payment Alert & Reference Input */}
                  {paymentRequired && (
                    <div 
                      id="payment-section"
                      className={paymentShake ? 'ft-shake' : ''}
                      style={{ 
                      background: 'rgba(13, 148, 136, 0.05)', 
                      border: '1.5px solid var(--ft-primary)', 
                      borderRadius: 'var(--ft-radius)',
                      padding: '1rem',
                      marginTop: '1rem',
                      marginBottom: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                      transition: 'all 0.3s'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: 'var(--ft-primary)', fontSize: '0.9rem' }}>
                        💰 Payment Required
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--ft-text-secondary)', margin: 0, lineHeight: 1.5 }}>
                        This training program or wave requires registration payment. Please click the button below to pay, and then upload your payment receipt to complete your registration.
                      </p>
                      {activePaymentLink ? (
                        <a 
                          href={activePaymentLink} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="ft-btn ft-btn-primary"
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', textDecoration: 'none', fontSize: '0.82rem', height: '36px', alignSelf: 'flex-start' }}
                        >
                          💳 Pay Now (Opens in new tab) ↗
                        </a>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: 'var(--ft-danger)', fontWeight: 600 }}>
                          ⚠️ Payment link is not configured by the admin yet.
                        </div>
                      )}
                      
                      <div className="ft-input-group" style={{ margin: 0, marginTop: '0.35rem' }}>
                        <label className="ft-label" style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>
                          Upload Payment Receipt (Image or PDF) *
                        </label>
                        <input 
                          key={receiptInputKey}
                          type="file" 
                          required
                          accept="image/*,application/pdf"
                          onChange={e => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setPaymentReceipt(reader.result);
                            };
                            reader.readAsDataURL(file);
                          }}
                          className="ft-input"
                          style={{ background: 'var(--ft-bg-card)', padding: '0.35rem', fontSize: '0.82rem' }}
                        />
                        {paymentReceipt && (
                          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#16a34a', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                              ✓ Receipt uploaded successfully
                            </span>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              {paymentReceipt.startsWith('data:image/') && (
                                <div style={{ border: '1px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', overflow: 'hidden', height: '80px', width: 'fit-content' }}>
                                  <img src={paymentReceipt} alt="Receipt preview" style={{ height: '100%', objectFit: 'contain' }} />
                                </div>
                              )}
                              <button
                                type="button"
                                className="ft-btn ft-btn-secondary"
                                onClick={() => {
                                  setPaymentReceipt('');
                                  setReceiptInputKey(prev => prev + 1);
                                }}
                                style={{ color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.2)', padding: '0.25rem 0.5rem', height: '30px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              >
                                ❌ Remove
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: '1rem' }}>
                    <button
                      className="ft-btn ft-btn-primary ft-btn-lg ft-w-full"
                      onClick={handleRegister}
                      disabled={registering || isPastDeadline || isFull || (place.waves && place.waves.length > 0 && !selectedWaveId) || (place.hasPrograms && !selectedProgramId)}
                      style={(isFull || isPastDeadline || (paymentRequired && !paymentReceipt)) ? { opacity: 0.5 } : {}}
                    >
                      {registering 
                        ? 'Registering...' 
                        : isPastDeadline 
                          ? '❌ Registration Closed (Deadline Passed)' 
                          : isFull 
                            ? 'Place is Full' 
                            : (place.hasPrograms && !selectedProgramId) 
                              ? 'Select a Program Above' 
                              : (place.waves && place.waves.length > 0 && !selectedWaveId) 
                                ? 'Select a Wave Above' 
                                : paymentRequired && !paymentReceipt
                                  ? 'Upload Payment Receipt to Register'
                                  : '🚀 Register for Training'
                      }
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '1rem 0 0', borderTop: '1px solid var(--ft-border-light)', fontSize: '0.85rem', color: 'var(--ft-text-secondary)', lineHeight: 1.6 }}>
                  <div style={{ background: 'var(--ft-bg-input)', border: '1px dashed var(--ft-border)', padding: '1rem', borderRadius: 'var(--ft-radius-md)' }}>
                    📢 <strong>Registration Notice:</strong> Enrollment is managed solely by university administrators via manual student imports. If you are pre-assigned to this place, your account will be linked automatically.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDeleteRegId && (
        <div className="ft-modal-overlay">
          <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="ft-modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>❌</div>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Remove Student?</h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--ft-text-secondary)', marginBottom: '1.5rem' }}>
                Are you sure you want to remove this student from this training place? This will cancel their registration.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="ft-btn ft-btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmDeleteRegId(null)}>Cancel</button>
                <button className="ft-btn ft-btn-danger" style={{ flex: 1 }} onClick={async () => {
                  const regId = confirmDeleteRegId;
                  setConfirmDeleteRegId(null);
                  try {
                    await db.ft_registrations.delete(regId);
                    setToast({ type: 'success', msg: 'Student removed successfully!' });
                  } catch (err) {
                    setToast({ type: 'error', msg: 'Failed to remove student: ' + err.message });
                  }
                  setTimeout(() => setToast(null), 3000);
                }}>Remove</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Date Conflict Modal */}
      {conflictModal && (
        <div className="ft-modal-overlay" onClick={() => setConflictModal(null)}>
          <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="ft-modal-header" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(251,146,60,0.08))', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
              <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--ft-danger)' }}>
                <AlertTriangle size={20} /> Schedule Conflict Detected
              </h2>
              <button className="ft-modal-close" onClick={() => setConflictModal(null)}><XCircle size={20} /></button>
            </div>
            <div className="ft-modal-body" style={{ padding: '1.25rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--ft-text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
                The wave you selected has overlapping dates with an existing registration. You cannot register for two waves that run at the same time.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {/* Attempted wave */}
                <div style={{ padding: '0.75rem', borderRadius: 'var(--ft-radius-sm)', border: '1.5px solid var(--ft-danger)', background: 'rgba(239,68,68,0.04)' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ft-danger)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>You are trying to register for</div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--ft-text)' }}>{conflictModal.targetPlace?.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-secondary)' }}>
                    {conflictModal.targetWave?.name} — 📅 {conflictModal.targetWave?.duration || `${conflictModal.targetDates?.start?.toLocaleDateString()} – ${conflictModal.targetDates?.end?.toLocaleDateString()}`}
                  </div>
                </div>

                {/* Conflicting registration */}
                <div style={{ padding: '0.75rem', borderRadius: 'var(--ft-radius-sm)', border: '1px solid var(--ft-border)', background: 'rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ft-warning, #f59e0b)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Conflicts with your existing registration</div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--ft-text)' }}>{conflictModal.conflictingPlace?.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-secondary)' }}>
                    {conflictModal.conflictingWave?.name} — 📅 {conflictModal.conflictingWave?.duration || `${conflictModal.conflictDates?.start?.toLocaleDateString()} – ${conflictModal.conflictDates?.end?.toLocaleDateString()}`}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ft-text-muted)', marginTop: '0.25rem' }}>
                    Status: {conflictModal.conflictingReg?.status}
                  </div>
                </div>
              </div>

              {/* Alternative Suggestions */}
              {conflictModal.alternatives && conflictModal.alternatives.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ft-primary)', marginBottom: '0.5rem' }}>
                    💡 Suggested Alternatives (no date conflict):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {conflictModal.alternatives.map(alt => (
                      <div 
                        key={alt.wave.id}
                        onClick={() => {
                          setSelectedWaveId(alt.wave.id);
                          setConflictModal(null);
                        }}
                        style={{
                          padding: '0.6rem 0.75rem',
                          borderRadius: 'var(--ft-radius-sm)',
                          border: '1px solid var(--ft-primary)',
                          background: 'var(--ft-primary-bg)',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--ft-primary)' }}>{alt.wave.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--ft-text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                          <span>📅 {alt.wave.duration}</span>
                          <span style={{ color: 'var(--ft-success)', fontWeight: 600 }}>{alt.seatsLeft} seats left</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {conflictModal.alternatives && conflictModal.alternatives.length === 0 && (
                <p style={{ fontSize: '0.82rem', color: 'var(--ft-text-muted)', fontStyle: 'italic', marginBottom: '0.75rem' }}>
                  ⚠️ No alternative non-conflicting waves are available at this time.
                </p>
              )}

              <button 
                className="ft-btn ft-btn-secondary" 
                style={{ width: '100%' }} 
                onClick={() => setConflictModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`ft-toast ft-toast-${toast.type}`}>
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{toast.msg}</span>
        </div>
      )}
    </>
  );
}
