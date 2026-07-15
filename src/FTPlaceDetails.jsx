import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { db } from './db';
import { ArrowLeft, Clock, MapPin, Users, GraduationCap, User, Building2, XCircle, Calendar } from 'lucide-react';

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

  const [showChangeForm, setShowChangeForm] = useState(false);
  const [changeProgramId, setChangeProgramId] = useState('');
  const [changeWaveId, setChangeWaveId] = useState('');

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

  const myRegistration = useMemo(() => {
    if (!registrations) return null;
    return registrations.find(r => r.placeId === placeId && r.studentId === userId);
  }, [registrations, placeId, userId]);

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

  const needsApproval = useMemo(() => {
    if (!place) return false;
    const isLocked = !allowSelfRegister;
    const isHidden = place.isVisible === false;
    const isPlaceFull = isFull;
    return isLocked || isHidden || isPlaceFull || isPastDeadline;
  }, [place, allowSelfRegister, isFull, isPastDeadline]);

  const displayHours = useMemo(() => {
    if (myRegistration) return myRegistration.creditHours || 0;
    if (place?.hasPrograms && place.programs && selectedProgramId) {
      const prog = place.programs.find(p => p.id === selectedProgramId);
      if (prog) return parseInt(prog.creditHours) || 0;
    }
    return place?.creditHours || 0;
  }, [place, myRegistration, selectedProgramId]);

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

  const handleRegister = async () => {
    if (myRegistration || registering) return;

    if (place?.hasPrograms) {
      if (!selectedProgramId) {
        setToast({ type: 'error', msg: 'Please select a training program.' });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      const chosenProgram = place.programs.find(p => p.id === selectedProgramId);
      if (chosenProgram?.waves && chosenProgram.waves.length > 0 && !selectedWaveId) {
        setToast({ type: 'error', msg: 'Please select a training wave/duration for your selected program.' });
        setTimeout(() => setToast(null), 3000);
        return;
      }

      setRegistering(true);
      const chosenWave = chosenProgram?.waves?.find(w => w.id === selectedWaveId);

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
          waveId: selectedWaveId || null,
          waveName: chosenWave ? `${chosenWave.name} (${chosenWave.duration})` : null,
        });

        setToast({ type: 'success', msg: 'Successfully registered! Your registration is pending approval.' });
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

    const chosenWave = place?.waves?.find(w => w.id === selectedWaveId);

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
        waveId: selectedWaveId || null,
        waveName: chosenWave ? `${chosenWave.name} (${chosenWave.duration})` : null,
      });

      setToast({ type: 'success', msg: 'Successfully registered! Your registration is pending approval.' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Registration failed: ' + err.message });
    }
    setRegistering(false);
    setTimeout(() => setToast(null), 4000);
  };

  const handleUnregister = async () => {
    if (!myRegistration) return;
    if (myRegistration.status === 'completed') {
      setToast({ type: 'error', msg: 'Cannot unregister from a completed training.' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (needsApproval) {
      try {
        await db.ft_registrations.update(myRegistration.id, {
          changeRequest: {
            type: 'cancel',
            requestedAt: new Date().toISOString()
          }
        });
        
        setToast({ type: 'success', msg: 'Cancellation request submitted for admin approval.' });
      } catch (err) {
        setToast({ type: 'error', msg: 'Failed to request cancellation: ' + err.message });
      }
    } else {
      try {
        await db.ft_registrations.delete(myRegistration.id);
        setToast({ type: 'success', msg: 'Registration cancelled successfully.' });
      } catch (err) {
        setToast({ type: 'error', msg: 'Failed to cancel registration: ' + err.message });
      }
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmitChangeRequest = async () => {
    if (!myRegistration) return;
    
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
        await db.ft_registrations.update(myRegistration.id, {
          changeRequest: {
            type: 'change',
            requestedAt: new Date().toISOString(),
            programId: changeProgramId || null,
            programName: requestedProgName || null,
            waveId: changeWaveId || null,
            waveName: requestedWaveName || null
          }
        });

        setToast({ type: 'success', msg: 'Change request submitted for admin approval.' });
      } else {
        await db.ft_registrations.update(myRegistration.id, {
          programId: changeProgramId || null,
          programName: requestedProgName || null,
          waveId: changeWaveId || null,
          waveName: requestedWaveName || null,
          updatedAt: new Date().toISOString()
        });
        setToast({ type: 'success', msg: 'Registration updated successfully.' });
      }
      setShowChangeForm(false);
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
                <div className="ft-place-info-row">
                  <Users size={16} style={{ color: 'var(--ft-text-muted)' }} />
                  <span className="ft-place-info-label">Registered</span>
                  <span className="ft-place-info-value" style={totalCapacity && regCount > totalCapacity ? { color: 'var(--ft-danger)', fontWeight: 700 } : {}}>
                    {regCount} students{totalCapacity && regCount > totalCapacity ? ' ⚠️' : ''}
                  </span>
                </div>
                {totalCapacity > 0 && (
                  <div className="ft-place-info-row">
                    <Building2 size={16} style={{ color: 'var(--ft-text-muted)' }} />
                    <span className="ft-place-info-label">Capacity</span>
                    <span className="ft-place-info-value">
                      {totalCapacity} spots
                      {regCount > totalCapacity && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--ft-danger)', background: 'rgba(239,68,68,0.1)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                          +{regCount - totalCapacity} overload
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {trainerDocs.length > 0 && (
                  <div className="ft-place-info-row" style={{ alignItems: 'flex-start' }}>
                    <User size={16} style={{ color: 'var(--ft-text-muted)', marginTop: '0.2rem' }} />
                    <span className="ft-place-info-label">Trainer{trainerDocs.length > 1 ? 's' : ''}</span>
                    <span className="ft-place-info-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                      {trainerDocs.map(t => (
                        <span key={t.id}>{t.name}</span>
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

              {allowSelfRegister ? (
                <>
                  {/* 1. If NOT registered: show registration selectors */}
                  {!myRegistration && (
                    <>
                      {/* Program Selection UI */}
                      {place.hasPrograms && place.programs && place.programs.length > 0 && (
                        <div style={{ padding: '1rem 0', borderTop: '1px solid var(--ft-border-light)', marginTop: '0.5rem' }}>
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
                            style={{ padding: '0.5rem', borderRadius: 'var(--ft-radius-sm)', border: '1px solid var(--ft-border)', outline: 'none', marginBottom: '0.5rem' }}
                          >
                            <option value="">-- Choose Program --</option>
                            {place.programs.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>

                          {/* Selected Program Details & Fees */}
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
                        <div style={{ padding: '1rem 0', borderTop: '1px solid var(--ft-border-light)', borderBottom: '1px solid var(--ft-border-light)', marginTop: '0.5rem' }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ft-text-secondary)', marginBottom: '0.75rem' }}>
                            Select Training Wave / Dates:
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {place.waves.map(w => {
                              const taken = waveStats[w.id] || 0;
                              const capacity = w.capacity || 0;
                              const isWaveFull = taken >= capacity;
                              const isSelected = selectedWaveId === w.id;
                              return (
                                <div
                                  key={w.id}
                                  onClick={() => !isWaveFull && setSelectedWaveId(w.id)}
                                  style={{
                                    padding: '0.65rem 0.85rem',
                                    borderRadius: 'var(--ft-radius-sm)',
                                    border: isSelected ? '1.5px solid var(--ft-primary)' : '1px solid var(--ft-border)',
                                    background: isSelected ? 'var(--ft-primary-bg)' : (isWaveFull ? 'rgba(0,0,0,0.02)' : 'var(--ft-bg-card)'),
                                    cursor: isWaveFull ? 'not-allowed' : 'pointer',
                                    opacity: isWaveFull ? 0.6 : 1,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.15rem',
                                    transition: 'all 0.2s',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.82rem', color: isSelected ? 'var(--ft-primary)' : 'var(--ft-text)' }}>
                                      {w.name}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: taken > capacity ? 'var(--ft-danger)' : isWaveFull ? 'var(--ft-danger)' : 'var(--ft-text-secondary)' }}>
                                      {taken > capacity 
                                        ? `Overloaded (+${taken - capacity})` 
                                        : isWaveFull 
                                          ? 'Full' 
                                          : `${capacity - taken} seats left`
                                      }
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--ft-text-secondary)' }}>
                                    📅 {w.duration}
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
                          <div style={{ padding: '1rem 0', borderTop: '1px solid var(--ft-border-light)', borderBottom: '1px solid var(--ft-border-light)', marginTop: '0.5rem' }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ft-text-secondary)', marginBottom: '0.75rem' }}>
                              Select Training Wave / Dates:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {chosenProgram.waves.map(w => {
                                const taken = waveStats[w.id] || 0;
                                const capacity = w.capacity || 0;
                                const isWaveFull = taken >= capacity;
                                const isSelected = selectedWaveId === w.id;
                                return (
                                  <div
                                    key={w.id}
                                    onClick={() => !isWaveFull && setSelectedWaveId(w.id)}
                                    style={{
                                      padding: '0.65rem 0.85rem',
                                      borderRadius: 'var(--ft-radius-sm)',
                                      border: isSelected ? '1.5px solid var(--ft-primary)' : '1px solid var(--ft-border)',
                                      background: isSelected ? 'var(--ft-primary-bg)' : (isWaveFull ? 'rgba(0,0,0,0.02)' : 'var(--ft-bg-card)'),
                                      cursor: isWaveFull ? 'not-allowed' : 'pointer',
                                      opacity: isWaveFull ? 0.6 : 1,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '0.15rem',
                                      transition: 'all 0.2s',
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontWeight: 700, fontSize: '0.82rem', color: isSelected ? 'var(--ft-primary)' : 'var(--ft-text)' }}>
                                        {w.name}
                                      </span>
                                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: taken > capacity ? 'var(--ft-danger)' : isWaveFull ? 'var(--ft-danger)' : 'var(--ft-text-secondary)' }}>
                                        {taken > capacity 
                                          ? `Overloaded (+${taken - capacity})` 
                                          : isWaveFull 
                                            ? 'Full' 
                                            : `${capacity - taken} seats left`
                                        }
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--ft-text-secondary)' }}>
                                      📅 {w.duration}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {/* Status & Action Buttons */}
                  <div style={{ padding: '1rem 0 0' }}>
                    {myRegistration ? (
                      <div>
                        <div className={`ft-badge ft-badge-${myRegistration.status}`} style={{ width: '100%', justifyContent: 'center', padding: '0.6rem', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                          {myRegistration.status === 'pending' && '🟡 Registration Pending'}
                          {myRegistration.status === 'active' && '🔵 Currently In Training'}
                          {myRegistration.status === 'completed' && '✅ Training Completed'}
                          {myRegistration.status === 'failed' && '🔴 Needs Re-training'}
                        </div>
                        
                        {myRegistration.programName && (() => {
                          const registeredProgram = place.programs?.find(p => p.id === myRegistration.programId || p.name === myRegistration.programName);
                          if (!registeredProgram) {
                            return (
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ft-text-secondary)', textAlign: 'center', marginBottom: '0.35rem', padding: '0.4rem', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius-sm)' }}>
                                🎓 Program: {myRegistration.programName}
                              </div>
                            );
                          }
                          return (
                            <div style={{ 
                              background: 'var(--ft-bg-input)', 
                              border: '1.5px solid var(--ft-border)', 
                              padding: '0.85rem', 
                              borderRadius: 'var(--ft-radius-sm)',
                              marginBottom: '0.75rem',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.5rem'
                            }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--ft-text)' }}>
                                🎓 Program: {registeredProgram.name}
                              </div>
                              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--ft-primary)', background: 'var(--ft-primary-bg)', padding: '0.05rem 0.35rem', borderRadius: '4px' }}>
                                  ⏱️ {registeredProgram.creditHours}h
                                </span>
                                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--ft-text-secondary)', background: 'rgba(0,0,0,0.05)', padding: '0.05rem 0.35rem', borderRadius: '4px' }}>
                                  👥 {registeredProgram.capacity} spots
                                </span>
                              </div>
                              {registeredProgram.description && (
                                <p style={{ color: 'var(--ft-text-secondary)', fontSize: '0.78rem', lineHeight: 1.5, margin: '0.25rem 0 0', whiteSpace: 'pre-wrap' }}>
                                  {registeredProgram.description}
                                </p>
                              )}
                            </div>
                          );
                        })()}
                        
                        {myRegistration.waveName && (
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ft-text-secondary)', textAlign: 'center', marginBottom: '0.75rem', padding: '0.4rem', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius-sm)' }}>
                            🌊 Wave: {myRegistration.waveName}
                          </div>
                        )}

                        {myRegistration.changeRequest ? (
                          <div style={{ padding: '0.75rem', border: '1px dashed var(--ft-warning)', borderRadius: 'var(--ft-radius-sm)', background: 'rgba(217, 119, 6, 0.04)', marginBottom: '0.75rem' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--ft-warning-text)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              ⏳ Request Pending Approval
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--ft-text-secondary)', marginTop: '0.2rem', marginBottom: '0.5rem' }}>
                              {myRegistration.changeRequest.type === 'cancel' 
                                ? 'Requested to totally cancel registration.' 
                                : `Requested change to: ${myRegistration.changeRequest.programName || ''} ${myRegistration.changeRequest.waveName ? `(${myRegistration.changeRequest.waveName})` : ''}`}
                            </div>
                            <button 
                              className="ft-btn ft-btn-secondary ft-btn-sm ft-w-full" 
                              onClick={async () => {
                                try {
                                  await db.ft_registrations.update(myRegistration.id, { changeRequest: null });
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
                          myRegistration.status !== 'completed' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {showChangeForm ? (
                                <div style={{ border: '1px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', padding: '0.75rem', background: 'var(--ft-bg-card)' }}>
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
                                        {place.programs.map(p => (
                                          <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
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
                                          {progWaves.map(w => (
                                            <option key={w.id} value={w.id}>{w.name} ({w.duration})</option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  })()}

                                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                    <button className="ft-btn ft-btn-primary ft-btn-sm" style={{ flex: 1, fontSize: '0.78rem' }} onClick={handleSubmitChangeRequest}>
                                      {needsApproval ? 'Submit Request' : 'Save Changes'}
                                    </button>
                                    <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ flex: 1, fontSize: '0.78rem' }} onClick={() => setShowChangeForm(false)}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button className="ft-btn ft-btn-primary ft-w-full" onClick={() => {
                                    setChangeProgramId(myRegistration.programId || '');
                                    setChangeWaveId(myRegistration.waveId || '');
                                    setShowChangeForm(true);
                                  }}>
                                    ✏️ {needsApproval ? 'Request Wave/Program Change' : 'Change Wave/Program'}
                                  </button>
                                  <button className="ft-btn ft-btn-secondary ft-w-full" onClick={handleUnregister} style={{ color: 'var(--ft-danger)' }}>
                                    {needsApproval ? 'Request Cancellation' : 'Cancel Registration'}
                                  </button>
                                </>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    ) : (
                      <button
                        className="ft-btn ft-btn-primary ft-btn-lg ft-w-full"
                        onClick={handleRegister}
                        disabled={registering || isPastDeadline || isFull || (place.waves && place.waves.length > 0 && !selectedWaveId) || (place.hasPrograms && !selectedProgramId)}
                        style={(isFull || isPastDeadline) ? { opacity: 0.5 } : {}}
                      >
                        {registering ? 'Registering...' : isPastDeadline ? '❌ Registration Closed (Deadline Passed)' : isFull ? 'Place is Full' : (place.hasPrograms && !selectedProgramId) ? 'Select a Program Above' : (place.waves && place.waves.length > 0 && !selectedWaveId) ? 'Select a Wave Above' : '🚀 Register for Training'}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {myRegistration ? (
                    <div style={{ padding: '1rem 0 0', borderTop: '1px solid var(--ft-border-light)' }}>
                      <div className={`ft-badge ft-badge-${myRegistration.status}`} style={{ width: '100%', justifyContent: 'center', padding: '0.6rem', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                        {myRegistration.status === 'pending' && '🟡 Registration Pending'}
                        {myRegistration.status === 'active' && '🔵 Currently In Training'}
                        {myRegistration.status === 'completed' && '✅ Training Completed'}
                        {myRegistration.status === 'failed' && '🔴 Needs Re-training'}
                      </div>
                      
                      {myRegistration.programName && (
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ft-text-secondary)', textAlign: 'center', marginBottom: '0.35rem', padding: '0.4rem', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius-sm)' }}>
                          🎓 Program: {myRegistration.programName}
                        </div>
                      )}
                      
                      {myRegistration.waveName && (
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ft-text-secondary)', textAlign: 'center', marginBottom: '0.75rem', padding: '0.4rem', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius-sm)' }}>
                          🌊 Wave: {myRegistration.waveName}
                        </div>
                      )}

                      {myRegistration.changeRequest ? (
                        <div style={{ padding: '0.75rem', border: '1px dashed var(--ft-warning)', borderRadius: 'var(--ft-radius-sm)', background: 'rgba(217, 119, 6, 0.04)', marginBottom: '0.75rem' }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--ft-warning-text)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            ⏳ Request Pending Approval
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--ft-text-secondary)', marginTop: '0.2rem', marginBottom: '0.5rem' }}>
                            {myRegistration.changeRequest.type === 'cancel' 
                              ? 'Requested to totally cancel registration.' 
                              : `Requested change to: ${myRegistration.changeRequest.programName || ''} ${myRegistration.changeRequest.waveName ? `(${myRegistration.changeRequest.waveName})` : ''}`}
                          </div>
                          <button 
                            className="ft-btn ft-btn-secondary ft-btn-sm ft-w-full" 
                            onClick={async () => {
                              try {
                                await db.ft_registrations.update(myRegistration.id, { changeRequest: null });
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
                        myRegistration.status !== 'completed' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {showChangeForm ? (
                              <div style={{ border: '1px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', padding: '0.75rem', background: 'var(--ft-bg-card)' }}>
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
                                      {place.programs.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                      ))}
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
                                        {progWaves.map(w => (
                                          <option key={w.id} value={w.id}>{w.name} ({w.duration})</option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                })()}

                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                  <button className="ft-btn ft-btn-primary ft-btn-sm" style={{ flex: 1, fontSize: '0.78rem' }} onClick={handleSubmitChangeRequest}>
                                    {needsApproval ? 'Submit Request' : 'Save Changes'}
                                  </button>
                                  <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ flex: 1, fontSize: '0.78rem' }} onClick={() => setShowChangeForm(false)}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button className="ft-btn ft-btn-primary ft-w-full" onClick={() => {
                                  setChangeProgramId(myRegistration.programId || '');
                                  setChangeWaveId(myRegistration.waveId || '');
                                  setShowChangeForm(true);
                                }}>
                                  ✏️ {needsApproval ? 'Request Wave/Program Change' : 'Change Wave/Program'}
                                </button>
                                <button className="ft-btn ft-btn-secondary ft-w-full" onClick={handleUnregister} style={{ color: 'var(--ft-danger)' }}>
                                  {needsApproval ? 'Request Cancellation' : 'Cancel Registration'}
                                </button>
                              </>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '1rem 0 0', borderTop: '1px solid var(--ft-border-light)', fontSize: '0.85rem', color: 'var(--ft-text-secondary)', lineHeight: 1.6 }}>
                      <div style={{ background: 'var(--ft-bg-input)', border: '1px dashed var(--ft-border)', padding: '1rem', borderRadius: 'var(--ft-radius-md)' }}>
                        📢 <strong>Registration Notice:</strong> Enrollment is managed solely by university administrators via manual student imports. If you are pre-assigned to this place, your account will be linked automatically.
                      </div>
                    </div>
                  )}
                </>
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
