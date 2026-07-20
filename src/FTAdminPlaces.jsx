import { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, firestore, getCollectionName, uploadFile } from './db';
import { collection, getDocs, query, onSnapshot } from 'firebase/firestore';
import { Plus, Pencil, Trash2, X, Search, Upload, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { FT_DEPARTMENTS, FT_REG_STATUS_ICONS, FT_REG_STATUS_LABELS, cleanWaveName } from './ftConstants';

const inFlightAdditions = new Set();

const formatDuration = (startStr, endStr) => {
  if (!startStr || !endStr) return '';
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
  const formatPart = (d) => {
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${weekday} ${day}/${month}`;
  };
  return `${formatPart(start)} to ${formatPart(end)}`;
};

const ensureTestStudentsForPlace = async (place, registrations) => {
  if (!place || !place.id) return;
  const testRegs = registrations?.filter(r => r.placeId === place.id && r.isTest) || [];
  const targetSpecs = [];

  if (place.hasPrograms && place.programs) {
    place.programs.forEach(prog => {
      if (prog.waves && prog.waves.length > 0) {
        prog.waves.forEach(w => {
          targetSpecs.push({
            programId: prog.id,
            programName: prog.name,
            waveId: w.id,
            waveName: `${w.name} (${w.duration})`
          });
        });
      } else {
        targetSpecs.push({
          programId: prog.id,
          programName: prog.name,
          waveId: null,
          waveName: null
        });
      }
    });
  } else if (place.waves && place.waves.length > 0) {
    place.waves.forEach(w => {
      targetSpecs.push({
        programId: null,
        programName: null,
        waveId: w.id,
        waveName: `${w.name} (${w.duration})`
      });
    });
  } else {
    targetSpecs.push({
      programId: null,
      programName: null,
      waveId: null,
      waveName: null
    });
  }

  // 1. Group test registrations and delete any duplicate registrations for the same wave/program
  const grouped = {};
  testRegs.forEach(r => {
    const key = `${r.programId || 'null'}_${r.waveId || 'null'}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  for (const key in grouped) {
    const list = grouped[key];
    if (list.length > 1) {
      const toDelete = list.slice(1);
      for (const r of toDelete) {
        const delKey = `delete_${r.id}`;
        if (inFlightAdditions.has(delKey)) continue;
        inFlightAdditions.add(delKey);
        try {
          await db.ft_registrations.delete(r.id);
        } catch (err) {
          console.error("Failed to delete duplicate test student:", err);
        } finally {
          setTimeout(() => inFlightAdditions.delete(delKey), 2000);
        }
      }
    }
  }

  // 2. Add missing test student registrations
  for (const spec of targetSpecs) {
    const key = `${place.id}_${spec.programId || 'null'}_${spec.waveId || 'null'}`;
    if (inFlightAdditions.has(key)) continue;

    const exists = testRegs.some(r => 
      (r.programId || null) === (spec.programId || null) && 
      (r.waveId || null) === (spec.waveId || null)
    );
    if (!exists) {
      inFlightAdditions.add(key);
      try {
        await db.ft_registrations.add({
          studentId: 'test_student_fallback',
          placeId: place.id,
          placeName: place.name,
          programId: spec.programId || null,
          programName: spec.programName || null,
          creditHours: place.creditHours || 0,
          status: 'active',
          registeredAt: new Date().toISOString(),
          studentName: 'Test Student',
          studentDepartment: place.department || 'Test Dept',
          studentUniversityId: 'TEST-0000',
          studentEmail: 'test.student@aiu.edu.eg',
          waveId: spec.waveId || null,
          waveName: spec.waveName || null,
          isTest: true
        });
      } catch (err) {
        console.error("Failed to add test student:", err);
      } finally {
        setTimeout(() => inFlightAdditions.delete(key), 2000);
      }
    }
  }

  // 3. Clean up obsolete test student registrations (e.g. if wave or program is removed)
  const obsoleteRegs = testRegs.filter(r => {
    return !targetSpecs.some(spec => 
      (spec.programId || null) === (r.programId || null) && 
      (spec.waveId || null) === (r.waveId || null)
    );
  });
  for (const r of obsoleteRegs) {
    const delKey = `delete_${r.id}`;
    if (inFlightAdditions.has(delKey)) continue;
    inFlightAdditions.add(delKey);
    try {
      await db.ft_registrations.delete(r.id);
    } catch (err) {
      console.error("Failed to delete obsolete test student:", err);
    } finally {
      setTimeout(() => inFlightAdditions.delete(delKey), 2000);
    }
  }
};

export default function FTAdminPlaces() {
  const { places, registrations, settings, resetRequests } = useOutletContext();

  const [showModal, setShowModal] = useState(false);
  const [editingPlace, setEditingPlace] = useState(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [expandedInsights, setExpandedInsights] = useState({});
  const [evaluations, setEvaluations] = useState([]);
  const [activeTab, setActiveTab] = useState('registrations');

  // Fetch evaluations
  useEffect(() => {
    const colEval = getCollectionName('ft_evaluations');
    const qEval = query(collection(firestore, colEval));
    const unsubscribeEval = onSnapshot(qEval, (snapshot) => {
      setEvaluations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribeEval();
    };
  }, []);
  const [trainers, setTrainers] = useState([]);
  const [scientists, setScientists] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [importingPlaceId, setImportingPlaceId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const [enrolledPlaceId, setEnrolledPlaceId] = useState(null);
  const [showEnrolledModal, setShowEnrolledModal] = useState(false);
  const [enrolledSearch, setEnrolledSearch] = useState('');
  const [confirmDeleteEnrollmentReg, setConfirmDeleteEnrollmentReg] = useState(null);

  // Manual enrollment form states
  const [showEnrollForm, setShowEnrollForm] = useState(false);
  const [enrollStudentId, setEnrollStudentId] = useState('');
  const [enrollStudentName, setEnrollStudentName] = useState('');
  const [enrollStudentEmail, setEnrollStudentEmail] = useState('');
  const [enrollStudentDept, setEnrollStudentDept] = useState('');
  const [enrollWaveId, setEnrollWaveId] = useState('');
  const [enrollProgramId, setEnrollProgramId] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleOpenEnrolledModal = (placeId) => {
    setEnrolledPlaceId(placeId);
    setEnrolledSearch('');
    setShowEnrolledModal(true);
    // Reset manual enroll form
    setShowEnrollForm(false);
    setEnrollStudentId('');
    setEnrollStudentName('');
    setEnrollStudentEmail('');
    setEnrollStudentDept('');
    setEnrollWaveId('');
    setEnrollProgramId('');
    setShowSuggestions(false);
  };

  const handleRemoveEnrollment = (reg) => {
    setConfirmDeleteEnrollmentReg(reg);
  };

  const handleManualEnroll = async (place) => {
    if (!enrollStudentId.trim()) {
      setToast({ type: 'error', msg: 'Please enter a Student ID.' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    
    // Check if already registered
    const isAlreadyRegistered = registrations?.some(r => 
      r.placeId === place.id && 
      r.studentUniversityId.trim() === enrollStudentId.trim() &&
      r.status !== 'failed'
    );
    if (isAlreadyRegistered) {
      setToast({ type: 'error', msg: 'This student is already enrolled in this training place.' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    try {
      const matchedSci = scientists.find(s => s.universityId === enrollStudentId.trim());
      
      let waveName = '';
      if (enrollWaveId) {
        let matchedw = place.waves?.find(w => w.id === enrollWaveId);
        if (!matchedw && place.hasPrograms && place.programs) {
          for (const prog of place.programs) {
            matchedw = prog.waves?.find(w => w.id === enrollWaveId);
            if (matchedw) break;
          }
        }
        if (matchedw) {
          waveName = `${matchedw.name} (${matchedw.duration})`;
        }
      }

      let programName = '';
      let creditHours = place.creditHours || 0;
      if (place.hasPrograms && enrollProgramId) {
        const matchedp = place.programs?.find(p => p.id === enrollProgramId);
        if (matchedp) {
          programName = matchedp.name;
          creditHours = parseInt(matchedp.creditHours) || creditHours;
        }
      }

      await db.ft_registrations.add({
        studentId: matchedSci?.id || null,
        placeId: place.id,
        placeName: place.name,
        programId: enrollProgramId || null,
        programName: programName || null,
        creditHours: creditHours,
        status: 'active',
        registeredAt: new Date().toISOString(),
        studentName: matchedSci?.name || enrollStudentName.trim() || 'Imported Trainee',
        studentDepartment: matchedSci?.department || enrollStudentDept.trim() || '',
        studentUniversityId: enrollStudentId.trim(),
        studentEmail: matchedSci?.email || enrollStudentEmail.trim() || '',
        waveId: enrollWaveId || null,
        waveName: waveName || null
      });

      setToast({ type: 'success', msg: 'Student enrolled successfully!' });
      setEnrollStudentId('');
      setEnrollStudentName('');
      setEnrollStudentEmail('');
      setEnrollStudentDept('');
      setEnrollWaveId('');
      setEnrollProgramId('');
      setShowEnrollForm(false);
    } catch (err) {
      setToast({ type: 'error', msg: 'Enrollment failed: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const [form, setForm] = useState({
    name: '', description: '', thesis: '', requirements: '',
    creditHours: '', department: '', capacity: '', trainerId: '', trainerIds: [], image: '',
    waves: [], isVisible: true
  });

  const handleOpenImportModal = (placeId) => {
    setImportingPlaceId(placeId);
    setShowImportModal(true);
  };

  const handleSelectCSVFile = () => {
    document.getElementById('bulk-import-csv').click();
  };

  const downloadImportTemplate = (place) => {
    const headers = ['University ID', 'Name', 'Email', 'Wave'];
    const hasMultiplePrograms = place.hasPrograms && place.programs && place.programs.length > 1;
    if (hasMultiplePrograms) {
      headers.push('Program');
    }

    const rows = [];
    
    // The test student must be registered for all waves/programs in the template to show how they are formatted
    if (hasMultiplePrograms) {
      place.programs.forEach(prog => {
        if (prog.waves && prog.waves.length > 0) {
          prog.waves.forEach(w => {
            rows.push([
              'TEST-0000',
              'Test Student',
              'test@student.com',
              w.name,
              prog.name
            ]);
          });
        } else {
          rows.push([
            'TEST-0000',
            'Test Student',
            'test@student.com',
            '—',
            prog.name
          ]);
        }
      });
    } else if (place.waves && place.waves.length > 0) {
      place.waves.forEach(w => {
        rows.push([
          'TEST-0000',
          'Test Student',
          'test@student.com',
          w.name
        ]);
      });
    } else {
      // Default placeholder if no waves defined yet
      rows.push([
        'TEST-0000',
        'Test Student',
        'test@student.com',
        'Wave 1'
      ]);
    }

    const csvContent = "\uFEFF" + [
      headers.join(','),
      ...rows.map(r => r.map(val => `"${val.replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${place.name.replace(/\s+/g, '_')}_import_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files[0];
    if (!file || !importingPlaceId) return;

    setShowImportModal(false);
    const place = places.find(p => p.id === importingPlaceId);
    if (!place) return;

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
          const existingReg = registrations?.find(r => 
            r.placeId === importingPlaceId && 
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
              placeId: importingPlaceId,
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
              placeId: importingPlaceId,
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
      setImportingPlaceId(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Load scientists and trainers
  useEffect(() => {
    (async () => {
      try {
        const col = getCollectionName('scientists');
        const snap = await getDocs(collection(firestore, col));
        const allScientists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setScientists(allScientists);
        const list = allScientists.filter(u => ['trainer', 'admin', 'master'].includes(u.role) && u.accountStatus === 'active');
        setTrainers(list);
      } catch (err) {
        console.error('Failed to load scientists:', err);
      }
    })();
  }, []);

  // Ensure test students for all places
  useEffect(() => {
    if (places && registrations) {
      (async () => {
        for (const place of places) {
          await ensureTestStudentsForPlace(place, registrations);
        }
      })();
    }
  }, [places, registrations]);

  const filteredPlaces = useMemo(() => {
    if (!places) return [];
    return places.filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()));
  }, [places, search]);

  const openAddModal = () => {
    setEditingPlace(null);
    setForm({
      name: '',
      description: '',
      thesis: '',
      requirements: '',
      creditHours: '',
      department: '',
      capacity: '',
      trainerId: '',
      trainerIds: [],
      image: '',
      waves: [],
      isVisible: true,
      hasPrograms: false,
      programs: [],
      registrationDeadline: '',
      payToRegister: false,
      paymentLink: ''
    });
    setShowModal(true);
  };

  const openEditModal = (place) => {
    setEditingPlace(place);
    setForm({
      name: place.name || '',
      description: place.description || '',
      thesis: place.thesis || '',
      requirements: place.requirements || '',
      creditHours: place.creditHours?.toString() || '',
      department: place.department || '',
      capacity: place.capacity?.toString() || '',
      trainerId: place.trainerId || '',
      trainerIds: place.trainerIds || (place.trainerId ? [place.trainerId] : []),
      image: place.image || '',
      waves: place.waves || [],
      isVisible: place.isVisible !== false,
      hasPrograms: place.hasPrograms === true,
      programs: place.programs || [],
      registrationDeadline: place.registrationDeadline || '',
      payToRegister: place.payToRegister || false,
      paymentLink: place.paymentLink || ''
    });
    setShowModal(true);
  };

  const handleAddWave = () => {
    setForm(f => ({
      ...f,
      waves: [
        ...(f.waves || []),
        {
          id: 'w_' + Math.random().toString(36).substr(2, 9),
          name: `Wave ${(f.waves?.length || 0) + 1}`,
          duration: '',
          capacity: '',
          startDate: '',
          endDate: '',
          deadline: '',
          payToRegister: false,
          paymentLink: ''
        }
      ]
    }));
  };

  const handleUpdateWave = (waveId, field, value) => {
    setForm(f => ({
      ...f,
      waves: (f.waves || []).map(w => {
        if (w.id === waveId) {
          const updated = { ...w, [field]: field === 'capacity' ? (value === '' ? '' : parseInt(value) || 0) : value };
          if (field === 'startDate' || field === 'endDate') {
            updated.duration = formatDuration(updated.startDate, updated.endDate);
          }
          return updated;
        }
        return w;
      })
    }));
  };

  const handleRemoveWave = (waveId) => {
    setForm(f => ({
      ...f,
      waves: (f.waves || []).filter(w => w.id !== waveId)
    }));
  };

  const handleAddProgram = () => {
    setForm(f => ({
      ...f,
      programs: [
        ...(f.programs || []),
        {
          id: 'prog_' + Math.random().toString(36).substr(2, 9),
          name: `Program ${(f.programs?.length || 0) + 1}`,
          description: '',
          creditHours: f.creditHours || '80',
          capacity: f.capacity || '20',
          waves: [],
          payToRegister: false,
          paymentLink: ''
        }
      ]
    }));
  };

  const handleUpdateProgram = (progId, field, value) => {
    setForm(f => ({
      ...f,
      programs: (f.programs || []).map(p => {
        if (p.id === progId) {
          return { ...p, [field]: value };
        }
        return p;
      })
    }));
  };

  const handleRemoveProgram = (progId) => {
    setForm(f => ({
      ...f,
      programs: (f.programs || []).filter(p => p.id !== progId)
    }));
  };

  const handleAddProgramWave = (progId) => {
    setForm(f => ({
      ...f,
      programs: (f.programs || []).map(p => {
        if (p.id === progId) {
          return {
            ...p,
            waves: [
              ...(p.waves || []),
              {
                id: 'w_' + Math.random().toString(36).substr(2, 9),
                name: `Wave ${(p.waves?.length || 0) + 1}`,
                duration: '',
                capacity: '',
                startDate: '',
                endDate: '',
                deadline: '',
                payToRegister: false,
                paymentLink: ''
              }
            ]
          };
        }
        return p;
      })
    }));
  };

  const handleUpdateProgramWave = (progId, waveId, field, value) => {
    setForm(f => ({
      ...f,
      programs: (f.programs || []).map(p => {
        if (p.id === progId) {
          return {
            ...p,
            waves: (p.waves || []).map(w => {
              if (w.id === waveId) {
                const updated = { ...w, [field]: field === 'capacity' ? (value === '' ? '' : parseInt(value) || 0) : value };
                if (field === 'startDate' || field === 'endDate') {
                  updated.duration = formatDuration(updated.startDate, updated.endDate);
                }
                return updated;
              }
              return w;
            })
          };
        }
        return p;
      })
    }));
  };

  const handleRemoveProgramWave = (progId, waveId) => {
    setForm(f => ({
      ...f,
      programs: (f.programs || []).map(p => {
        if (p.id === progId) {
          return {
            ...p,
            waves: (p.waves || []).filter(w => w.id !== waveId)
          };
        }
        return p;
      })
    }));
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const url = await uploadFile(file, `ft_places/${Date.now()}_${file.name}`);
      setForm(f => ({ ...f, image: url }));
    } catch (err) {
      setToast({ type: 'error', msg: 'Image upload failed: ' + err.message });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);

    const data = {
      name: form.name.trim(),
      description: form.description.trim(),
      thesis: form.thesis.trim(),
      requirements: form.requirements.trim(),
      creditHours: parseInt(form.creditHours) || 0,
      department: form.department,
      capacity: form.capacity ? parseInt(form.capacity) : null,
      trainerId: form.trainerIds?.[0] || null,
      trainerIds: form.trainerIds || [],
      image: form.image || null,
      waves: form.waves || [],
      isVisible: form.isVisible !== false,
      hasPrograms: form.hasPrograms === true,
      programs: form.programs || [],
      registrationDeadline: form.registrationDeadline || '',
      payToRegister: form.payToRegister || false,
      paymentLink: form.paymentLink || '',
      updatedAt: new Date().toISOString(),
    };

    try {
      if (editingPlace) {
        await db.ft_places.update(editingPlace.id, data);
        setToast({ type: 'success', msg: 'Place updated successfully!' });
      } else {
        data.createdAt = new Date().toISOString();
        await db.ft_places.add(data);
        setToast({ type: 'success', msg: 'Place added successfully!' });
      }
      setShowModal(false);
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed: ' + err.message });
    }
    setSubmitting(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (placeId) => {
    try {
      await db.ft_places.delete(placeId);
      setConfirmDelete(null);
      setToast({ type: 'success', msg: 'Place deleted.' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Delete failed: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const pendingRegs = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(r => r.status === 'pending');
  }, [registrations]);

  const changeRequests = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(r => r.changeRequest);
  }, [registrations]);

  const handleApproveReg = async (regId) => {
    try {
      const reg = await db.ft_registrations.get(regId);
      await db.ft_registrations.update(regId, { status: 'active', approvedAt: new Date().toISOString() });
      
      if (reg) {
        await db.ft_notifications.add({
          title: 'Registration Approved 🎉',
          message: `Your registration for ${reg.placeName} has been approved!`,
          type: 'registration_approved',
          status: 'unread',
          targetRoles: ['student', 'user'],
          targetUserId: reg.studentId,
          createdAt: new Date().toISOString(),
          link: '/my-training'
        });
      }
      
      setToast({ type: 'success', msg: 'Registration approved successfully!' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to approve: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleRejectReg = async (regId) => {
    try {
      const reg = await db.ft_registrations.get(regId);
      await db.ft_registrations.delete(regId);
      
      if (reg) {
        await db.ft_notifications.add({
          title: 'Registration Rejected ❌',
          message: `Your registration for ${reg.placeName} has been rejected.`,
          type: 'registration_rejected',
          status: 'unread',
          targetRoles: ['student', 'user'],
          targetUserId: reg.studentId,
          createdAt: new Date().toISOString(),
          link: '/'
        });
      }
      
      setToast({ type: 'success', msg: 'Registration rejected.' });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to reject: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleApproveReset = async (reqId) => {
    try {
      const resetReq = await db.ft_reset_requests.get(reqId);
      await db.ft_reset_requests.update(reqId, {
        status: 'approved',
        approvedAt: new Date().toISOString()
      });

      if (resetReq) {
        const usersCol = getCollectionName('scientists');
        const q = query(collection(firestore, usersCol), where('username', '==', resetReq.username));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const userDocId = snap.docs[0].id;
          await db.ft_notifications.add({
            title: 'Password Reset Approved 🔑',
            message: `Your password reset request has been approved! You can now reset it from the login screen.`,
            type: 'password_reset_approved',
            status: 'unread',
            targetRoles: ['student', 'user', 'trainer'],
            targetUserId: userDocId,
            createdAt: new Date().toISOString(),
            link: '/'
          });
        }
      }

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



  const handleApproveChangeRequest = async (reg) => {
    const { changeRequest } = reg;
    if (!changeRequest) return;
    try {
      if (changeRequest.type === 'cancel') {
        await db.ft_registrations.delete(reg.id);
        
        await db.ft_notifications.add({
          title: 'Cancellation Request Approved 👋',
          message: `Your cancellation request for ${reg.placeName} has been approved.`,
          type: 'cancellation_approved',
          status: 'unread',
          targetRoles: ['student', 'user'],
          targetUserId: reg.studentId,
          createdAt: new Date().toISOString(),
          link: '/'
        });

        setToast({ type: 'success', msg: `Approved cancellation request for ${reg.studentName}.` });
      } else if (changeRequest.type === 'change') {
        await db.ft_registrations.update(reg.id, {
          programId: changeRequest.programId || null,
          programName: changeRequest.programName || null,
          waveId: changeRequest.waveId || null,
          waveName: changeRequest.waveName || null,
          changeRequest: null
        });

        await db.ft_notifications.add({
          title: 'Change Request Approved 🔄',
          message: `Your change request for ${reg.placeName} has been approved! (New: ${changeRequest.programName || ''} ${changeRequest.waveName ? `(${changeRequest.waveName})` : ''})`,
          type: 'change_approved',
          status: 'unread',
          targetRoles: ['student', 'user'],
          targetUserId: reg.studentId,
          createdAt: new Date().toISOString(),
          link: '/my-training'
        });

        setToast({ type: 'success', msg: `Approved change request for ${reg.studentName}.` });
      }
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to approve: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleRejectChangeRequest = async (reg) => {
    try {
      await db.ft_registrations.update(reg.id, {
        changeRequest: null
      });

      await db.ft_notifications.add({
        title: 'Change Request Rejected ❌',
        message: `Your change/cancellation request for ${reg.placeName} was rejected by the admin.`,
        type: 'change_rejected',
        status: 'unread',
        targetRoles: ['student', 'user'],
        targetUserId: reg.studentId,
        createdAt: new Date().toISOString(),
        link: '/my-training'
      });

      setToast({ type: 'info', msg: `Rejected request for ${reg.studentName}.` });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to reject: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const handleApproveAll = async () => {
    if (!pendingRegs || pendingRegs.length === 0) return;
    try {
      const promises = pendingRegs.map(reg =>
        db.ft_registrations.update(reg.id, { status: 'active', approvedAt: new Date().toISOString() })
      );
      await Promise.all(promises);
      setToast({ type: 'success', msg: `Successfully approved all ${pendingRegs.length} pending registrations!` });
    } catch (err) {
      setToast({ type: 'error', msg: 'Failed to approve all: ' + err.message });
    }
    setTimeout(() => setToast(null), 3000);
  };

  const exportPlaceCSV = (place) => {
    const placeRegs = registrations?.filter(r => r.placeId === place.id && r.status !== 'failed') || [];
    const hasMultiplePrograms = place.hasPrograms && place.programs && place.programs.length > 1;

    let headers = ['Student Name', 'University ID', 'Student Phone', 'Department', 'Selected Wave', 'Wave Start Date', 'Wave End Date', 'Wave Deadline', 'Payment Required', 'Payment Receipt', 'Registration Status', 'Registered Date'];
    if (hasMultiplePrograms) {
      headers = ['Student Name', 'University ID', 'Student Phone', 'Department', 'Program', 'Selected Wave', 'Wave Start Date', 'Wave End Date', 'Wave Deadline', 'Payment Required', 'Payment Receipt', 'Registration Status', 'Registered Date'];
    }

    const rows = placeRegs.map(r => {
      const row = [
        `"${r.studentName || '—'}"`,
        `"${r.studentUniversityId || '—'}"`,
        `"${r.studentPhone || '—'}"`,
        `"${r.studentDepartment || '—'}"`
      ];
      if (hasMultiplePrograms) {
        row.push(`"${r.programName || '—'}"`);
      }
      
      const matchedWave = place.hasPrograms 
        ? place.programs?.find(p => p.id === r.programId)?.waves?.find(w => w.id === r.waveId)
        : place.waves?.find(w => w.id === r.waveId);

      row.push(
        `"${r.waveName || 'Global Capacity'}"`,
        `"${matchedWave?.startDate || '—'}"`,
        `"${matchedWave?.endDate || '—'}"`,
        `"${matchedWave?.deadline || '—'}"`,
        `"${r.paymentRequired ? 'Yes' : 'No'}"`,
        `"${r.paymentReceipt ? 'Yes (Uploaded)' : (r.paymentRef || 'No')}"`,
        `"${r.status}"`,
        `"${r.registeredAt ? new Date(r.registeredAt).toLocaleString() : '—'}"`
      );
      return row;
    });

    const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registrations_${place.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="ft-animate-in">
        <div className="ft-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 className="ft-page-title">Manage Places</h1>
            <p className="ft-page-subtitle">Add, edit, or remove training places.</p>
          </div>
          <button className="ft-btn ft-btn-primary" onClick={openAddModal}>
            <Plus size={18} /> Add Place
          </button>
        </div>

        {/* Admin Dashboard Hub */}
        <div className="ft-card ft-animate-in" style={{ marginBottom: '2.5rem', padding: '1.25rem' }}>
          <div className="ft-admin-hub-header">
            <h2 className="ft-admin-hub-title">
              📊 Admin Requests & Dashboard Hub
            </h2>
            <div className="ft-admin-hub-tabs">
              {[
                { id: 'registrations', label: '⏳ Registrations', count: pendingRegs.length },
                { id: 'changes', label: '🔄 Changes', count: changeRequests.length },
                { id: 'resets', label: '🔑 Password Resets', count: (resetRequests || []).filter(r => r.status === 'pending').length },
                { id: 'notes', label: '📋 Supervisor Notes', count: evaluations.length }
              ].map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`ft-btn ${activeTab === t.id ? 'ft-btn-primary' : 'ft-btn-ghost'}`}
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', height: 'auto', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}
                >
                  <span>{t.label}</span>
                  {t.count > 0 && (
                    <span style={{
                      background: t.id === 'notes' ? 'rgba(0,0,0,0.08)' : 'var(--ft-danger)',
                      color: t.id === 'notes' ? 'var(--ft-text-secondary)' : 'white',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      borderRadius: '999px',
                      padding: '0.1rem 0.35rem',
                      lineHeight: 1,
                      minWidth: '15px',
                      height: '15px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* TAB 2: Registrations */}
          {activeTab === 'registrations' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--ft-text-muted)', margin: 0 }}>
                  Approve or reject students requesting to register for training spots.
                </p>
                {pendingRegs.length > 0 && (
                  <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={handleApproveAll} style={{ fontSize: '0.78rem' }}>
                    ✅ Approve All
                  </button>
                )}
              </div>

              {pendingRegs.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ft-text-muted)', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius)', fontSize: '0.82rem' }}>
                  🎉 No pending registrations!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '350px', overflowY: 'auto' }}>
                  {pendingRegs.map(reg => {
                    const place = places?.find(p => p.id === reg.placeId);
                    let capacity = null;
                    let taken = 0;
                    let pendingCount = 0;

                    if (place) {
                      if (reg.programId) {
                        const prog = place.programs?.find(p => p.id === reg.programId);
                        if (prog) {
                          if (reg.waveId) {
                            const wave = prog.waves?.find(w => w.id === reg.waveId);
                            capacity = wave?.capacity;
                            taken = registrations?.filter(r => r.placeId === place.id && r.programId === prog.id && r.waveId === wave.id && r.status === 'active').length || 0;
                            pendingCount = registrations?.filter(r => r.placeId === place.id && r.programId === prog.id && r.waveId === wave.id && r.status === 'pending' && r.id !== reg.id).length || 0;
                          } else {
                            capacity = prog.capacity;
                            taken = registrations?.filter(r => r.placeId === place.id && r.programId === prog.id && r.status === 'active').length || 0;
                            pendingCount = registrations?.filter(r => r.placeId === place.id && r.programId === prog.id && r.status === 'pending' && r.id !== reg.id).length || 0;
                          }
                        }
                      } else if (reg.waveId) {
                        const wave = place.waves?.find(w => w.id === reg.waveId);
                        capacity = wave?.capacity;
                        taken = registrations?.filter(r => r.placeId === place.id && r.waveId === wave.id && r.status === 'active').length || 0;
                        pendingCount = registrations?.filter(r => r.placeId === place.id && r.waveId === wave.id && r.status === 'pending' && r.id !== reg.id).length || 0;
                      } else {
                        capacity = place.capacity;
                        taken = registrations?.filter(r => r.placeId === place.id && r.status === 'active').length || 0;
                        pendingCount = registrations?.filter(r => r.placeId === place.id && r.status === 'pending' && r.id !== reg.id).length || 0;
                      }
                    }

                    return (
                      <div key={reg.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--ft-bg-input)', padding: '0.75rem 1rem', borderRadius: 'var(--ft-radius-sm)', border: '1.5px solid var(--ft-border)', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{reg.studentName}</span>
                            {reg.studentUniversityId && (
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ft-primary)', background: 'var(--ft-primary-bg)', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid rgba(190, 18, 60, 0.12)' }}>
                                ID: {reg.studentUniversityId}
                              </span>
                            )}
                            <span style={{ fontSize: '0.78rem', color: 'var(--ft-primary)', background: 'var(--ft-primary-bg)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                              {reg.studentDepartment}
                            </span>
                            {reg.paymentReceipt ? (
                              <button 
                                onClick={() => {
                                  const w = window.open();
                                  w.document.write(`<iframe src="${reg.paymentReceipt}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                                }}
                                className="ft-btn ft-btn-secondary ft-btn-sm"
                                style={{ fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: '#16a34a', borderColor: 'rgba(22, 163, 74, 0.15)', background: '#dcfce7', padding: '0.15rem 0.4rem', height: 'auto' }}
                              >
                                📄 View Receipt
                              </button>
                            ) : reg.paymentRef ? (
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid rgba(22, 163, 74, 0.15)' }}>
                                💰 Paid (Ref: {reg.paymentRef})
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--ft-text-secondary)', marginTop: '0.25rem' }}>
                            registered for <strong style={{ color: 'var(--ft-text)' }}>{reg.placeName}</strong> 
                            {reg.waveName && <span style={{ color: 'var(--ft-primary)', fontWeight: 600 }}> · Wave: {reg.waveName}</span>}
                          </div>
                          
                          {/* Seat Capacity Breakdown */}
                          {capacity !== null && capacity !== undefined ? (
                            <div style={{ marginTop: '0.35rem', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              {taken > capacity ? (
                                <span style={{ color: 'var(--ft-danger)', fontWeight: 700, background: 'rgba(239, 68, 68, 0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                                  ⚠️ Overloaded ({taken}/{capacity} seats)
                                </span>
                              ) : taken === capacity ? (
                                <span style={{ color: '#d97706', fontWeight: 700, background: '#fef3c7', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(217, 119, 6, 0.15)' }}>
                                  ⚠️ Full ({taken}/{capacity} seats)
                                </span>
                              ) : (
                                <span style={{ color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(22, 163, 74, 0.15)' }}>
                                  ✅ {capacity - taken} seats available ({taken}/{capacity} taken)
                                </span>
                              )}
                              {pendingCount > 0 && (
                                <span style={{ color: 'var(--ft-text-muted)', fontSize: '0.72rem', background: 'rgba(0,0,0,0.04)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                  ({pendingCount} other pending request{pendingCount > 1 ? 's' : ''})
                                </span>
                              )}
                            </div>
                          ) : (
                            <div style={{ marginTop: '0.35rem', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span style={{ color: 'var(--ft-text-secondary)', fontWeight: 600, background: 'rgba(0,0,0,0.04)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                ℹ️ Unlimited Capacity ({taken} active registrations)
                              </span>
                              {pendingCount > 0 && (
                                <span style={{ color: 'var(--ft-text-muted)', fontSize: '0.72rem', background: 'rgba(0,0,0,0.04)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                  ({pendingCount} other pending request{pendingCount > 1 ? 's' : ''})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={() => handleApproveReg(reg.id)}>
                            Approve
                          </button>
                          <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ color: 'var(--ft-danger)' }} onClick={() => handleRejectReg(reg.id)}>
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Changes & Cancellations */}
          {activeTab === 'changes' && (
            <div>
              <p style={{ fontSize: '0.82rem', color: 'var(--ft-text-muted)', marginBottom: '0.75rem' }}>
                Manage students requesting to switch waves/programs, or fully cancel their training spots.
              </p>

              {changeRequests.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ft-text-muted)', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius)', fontSize: '0.82rem' }}>
                  🎉 No pending change or cancellation requests!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '350px', overflowY: 'auto' }}>
                  {changeRequests.map(reg => (
                    <div key={reg.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--ft-bg-input)', padding: '0.75rem 1rem', borderRadius: 'var(--ft-radius-sm)', border: '1.5px solid var(--ft-border)', flexWrap: 'wrap', gap: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{reg.studentName}</span>
                          {reg.studentUniversityId && (
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ft-primary)', background: 'var(--ft-primary-bg)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                              ID: {reg.studentUniversityId}
                            </span>
                          )}
                          <span style={{ fontSize: '0.78rem', color: 'var(--ft-primary)', background: 'var(--ft-primary-bg)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                            {reg.studentDepartment}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--ft-text-secondary)', marginTop: '0.35rem' }}>
                          Registered place: <strong>{reg.placeName}</strong>
                          {reg.waveName && <span> (Wave: {reg.waveName})</span>}
                          {reg.programName && <span> (Program: {reg.programName})</span>}
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--ft-warning-text)', fontWeight: 600, marginTop: '0.25rem', background: 'rgba(217, 119, 6, 0.1)', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'inline-block' }}>
                          👉 Requested Action: {reg.changeRequest.type === 'cancel' ? (
                            <strong>Totally Cancel Registration</strong>
                          ) : (
                            <span>
                              Change to: <strong>{reg.changeRequest.programName || reg.programName || 'Same Program'}</strong> 
                              {reg.changeRequest.waveName && <span> · Wave: <strong>{reg.changeRequest.waveName}</strong></span>}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={() => handleApproveChangeRequest(reg)}>
                          Approve Request
                        </button>
                        <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ color: 'var(--ft-danger)' }} onClick={() => handleRejectChangeRequest(reg)}>
                          Reject Request
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Password Resets */}
          {activeTab === 'resets' && (
            <div>
              <p style={{ fontSize: '0.82rem', color: 'var(--ft-text-muted)', marginBottom: '0.75rem' }}>
                Approve password reset requests submitted by locked out students or supervisors.
              </p>

              {(resetRequests || []).filter(r => r.status === 'pending').length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ft-text-muted)', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius)', fontSize: '0.82rem' }}>
                  🎉 No pending password reset requests!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '350px', overflowY: 'auto' }}>
                  {(resetRequests || []).filter(r => r.status === 'pending').map(req => (
                    <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1.5px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', background: 'var(--ft-bg-input)', flexWrap: 'wrap', gap: '1rem' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                          Username: <span style={{ color: 'var(--ft-primary)' }}>{req.username}</span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', marginTop: '0.15rem' }}>
                          Email: {req.email}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={() => handleApproveReset(req.id)}>
                          Approve
                        </button>
                        <button className="ft-btn ft-btn-secondary ft-btn-sm" style={{ color: 'var(--ft-danger)', borderColor: 'rgba(239, 68, 68, 0.15)' }} onClick={() => handleRejectReset(req.id)}>
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: Supervisor evaluation notes */}
          {activeTab === 'notes' && (
            <div>
              <p style={{ fontSize: '0.82rem', color: 'var(--ft-text-muted)', marginBottom: '0.75rem' }}>
                All evaluation notes, performance comments, and feedback written by supervisors for trainees.
              </p>

              {evaluations.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ft-text-muted)', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius)', fontSize: '0.82rem' }}>
                  📋 No evaluation notes or feedback comments submitted yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '350px', overflowY: 'auto' }}>
                  {evaluations.map(ev => (
                    <div key={ev.id} style={{ background: 'var(--ft-bg-input)', padding: '0.85rem 1rem', borderRadius: 'var(--ft-radius-sm)', border: '1.5px solid var(--ft-border)', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.35rem', borderBottom: '1px dashed var(--ft-border-light)', paddingBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>👨‍🎓 Trainee: {ev.studentName} ({ev.studentUniversityId || 'No ID'})</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--ft-primary)', fontWeight: 700 }}>🏆 Grade: {ev.grade} ({ev.score}%)</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--ft-text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', fontStyle: 'italic', background: 'var(--ft-bg-card)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--ft-border-light)' }}>
                        "{ev.comments || 'No comment written.'}"
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--ft-text-muted)', marginTop: '0.35rem', textAlign: 'right' }}>
                        Evaluated by: <strong>{ev.evaluatedBy || 'Supervisor'}</strong> on {ev.createdAt ? new Date(ev.createdAt).toLocaleDateString() : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="ft-search-bar" style={{ marginBottom: '1.5rem' }}>
          <div className="ft-search-input-wrapper" style={{ maxWidth: '400px' }}>
            <Search size={18} />
            <input type="text" placeholder="Search places..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>
            {filteredPlaces.length} place{filteredPlaces.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Places Table */}
        {filteredPlaces.length === 0 ? (
          <div className="ft-empty">
            <div className="ft-empty-icon">🏗️</div>
            <div className="ft-empty-title">No Training Places</div>
            <div className="ft-empty-text">Get started by adding your first training place.</div>
            <button className="ft-btn ft-btn-primary" onClick={openAddModal}><Plus size={16} /> Add Place</button>
          </div>
        ) : (
          <div className="ft-table-wrapper">
            <table className="ft-table" style={{ minWidth: '950px' }}>
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Department</th>
                  <th>Credit Hours</th>
                  <th>Students</th>
                  <th>Trainers</th>
                  <th style={{ width: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlaces.map(place => {
                  const assignedTrainers = trainers.filter(t => place.trainerIds?.includes(t.id) || t.id === place.trainerId);
                  
                  let totalCapacity = 0;
                  const now = new Date();
                  if (place.hasPrograms && place.programs) {
                    place.programs.forEach(prog => {
                      if (prog.waves && prog.waves.length > 0) {
                        totalCapacity += prog.waves.reduce((sum, w) => sum + (parseInt(w.capacity) || 0), 0);
                      } else {
                        totalCapacity += parseInt(prog.capacity) || 0;
                      }
                    });
                  } else if (place.waves && place.waves.length > 0) {
                    totalCapacity = place.waves.reduce((sum, w) => sum + (parseInt(w.capacity) || 0), 0);
                  } else {
                    totalCapacity = parseInt(place.capacity) || 0;
                  }

                  const placeRegs = registrations?.filter(r => r.placeId === place.id && r.status !== 'failed' && !r.isTest) || [];
                  const regCount = placeRegs.length;
                  
                  // Calculate remaining available spots correctly (capping wave/program overloads at 0, and ignoring past deadlines)
                  let remaining = 0;
                  if (place.hasPrograms && place.programs) {
                    place.programs.forEach(prog => {
                      const progRegs = placeRegs.filter(r => r.programId === prog.id);
                      if (prog.waves && prog.waves.length > 0) {
                        prog.waves.forEach(w => {
                          const waveRegsCount = progRegs.filter(r => r.waveId === w.id).length;
                          const isPast = w.deadline ? new Date(w.deadline) < now : false;
                          const wCap = isPast ? 0 : (parseInt(w.capacity) || 0);
                          remaining += Math.max(0, wCap - waveRegsCount);
                        });
                      } else {
                        const pCap = parseInt(prog.capacity) || 0;
                        remaining += Math.max(0, pCap - progRegs.length);
                      }
                    });
                  } else if (place.waves && place.waves.length > 0) {
                    place.waves.forEach(w => {
                      const waveRegsCount = placeRegs.filter(r => r.waveId === w.id).length;
                      const isPast = w.deadline ? new Date(w.deadline) < now : false;
                      const wCap = isPast ? 0 : (parseInt(w.capacity) || 0);
                      remaining += Math.max(0, wCap - waveRegsCount);
                    });
                  } else {
                    const pCap = parseInt(place.capacity) || 0;
                    remaining = Math.max(0, pCap - placeRegs.length);
                  }

                  // const effectiveRegCount = totalCapacity - remaining;
                  
                  return (
                    <tr key={place.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--ft-radius-sm)', overflow: 'hidden', flexShrink: 0 }}>
                            {place.image ? (
                              <img src={place.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: '100%', height: '100%', background: 'var(--ft-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>🏢</div>
                            )}
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontWeight: 600 }}>{place.name}</span>
                              {place.isVisible === false ? (
                                <span className="ft-badge ft-badge-failed" style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Hidden</span>
                              ) : (
                                <span className="ft-badge ft-badge-completed" style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Visible</span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)' }}>{(place.description || '').substring(0, 50)}{(place.description || '').length > 50 ? '...' : ''}</div>
                            
                            {/* Toggle seats breakdown & Enrolled Students */}
                            <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setExpandedInsights(prev => ({ ...prev, [place.id]: !prev[place.id] })); }}
                                className="ft-btn ft-btn-sm"
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  height: 'auto',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  color: 'var(--ft-text-secondary)',
                                  background: 'var(--ft-bg-card)',
                                  border: '1.5px solid var(--ft-border)',
                                  borderRadius: 'var(--ft-radius-sm)',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--ft-bg-input)';
                                  e.currentTarget.style.borderColor = 'var(--ft-border-hover)';
                                  e.currentTarget.style.color = 'var(--ft-text)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'var(--ft-bg-card)';
                                  e.currentTarget.style.borderColor = 'var(--ft-border)';
                                  e.currentTarget.style.color = 'var(--ft-text-secondary)';
                                }}
                              >
                                📊 {expandedInsights[place.id] ? 'Hide Seats Breakdown' : 'Show Seats Breakdown'}
                                {expandedInsights[place.id] ? <ChevronUp size={13} style={{ marginLeft: '0.1rem' }} /> : <ChevronDown size={13} style={{ marginLeft: '0.1rem' }} />}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleOpenEnrolledModal(place.id); }}
                                className="ft-btn ft-btn-sm"
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  height: 'auto',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  color: 'var(--ft-text-secondary)',
                                  background: 'var(--ft-bg-card)',
                                  border: '1.5px solid var(--ft-border)',
                                  borderRadius: 'var(--ft-radius-sm)',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--ft-bg-input)';
                                  e.currentTarget.style.borderColor = 'var(--ft-border-hover)';
                                  e.currentTarget.style.color = 'var(--ft-text)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'var(--ft-bg-card)';
                                  e.currentTarget.style.borderColor = 'var(--ft-border)';
                                  e.currentTarget.style.color = 'var(--ft-text-secondary)';
                                }}
                              >
                                👥 Enrolled Students
                              </button>
                            </div>

                            {expandedInsights[place.id] && (
                              <div style={{ marginTop: '0.5rem', background: 'var(--ft-bg-input)', border: '1.5px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', padding: '0.6rem 0.75rem', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '420px', maxWidth: '100%' }}>
                                <div style={{ fontWeight: 700, color: 'var(--ft-text-secondary)', borderBottom: '1px solid var(--ft-border-light)', paddingBottom: '0.2rem', marginBottom: '0.2rem' }}>
                                  📊 Seats & Waves Insights
                                </div>
                                {(() => {
                                  if (place.hasPrograms && place.programs) {
                                    return place.programs.map(prog => {
                                      const progRegs = registrations?.filter(r => r.placeId === place.id && r.programId === prog.id && r.status !== 'failed' && !r.isTest) || [];
                                      
                                      let progCap = 0;
                                      if (prog.waves && prog.waves.length > 0) {
                                        progCap = prog.waves.reduce((sum, w) => sum + (parseInt(w.capacity) || 0), 0);
                                      } else {
                                        progCap = parseInt(prog.capacity) || 0;
                                      }

                                      return (
                                        <div key={prog.id} style={{ marginBottom: '0.35rem' }}>
                                          <div style={{ fontWeight: 700, color: 'var(--ft-text)' }}>🎓 {prog.name}: {progRegs.length}/{progCap} spots</div>
                                          {prog.waves && prog.waves.length > 0 ? (
                                            <div style={{ paddingLeft: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.15rem', marginTop: '0.15rem' }}>
                                              {prog.waves.map(w => {
                                                const waveRegs = progRegs.filter(r => r.waveId === w.id);
                                                const isPast = w.deadline ? new Date(w.deadline) < now : false;
                                                const cap = isPast ? 0 : (parseInt(w.capacity) || 0);
                                                const rem = cap - waveRegs.length;
                                                const actualCap = parseInt(w.capacity) || 0;
                                                const actualRem = actualCap - waveRegs.length;
                                                return (
                                                  <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ft-text-muted)', fontSize: '0.74rem', marginBottom: '0.2rem' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                      <span>🌊 {w.name}: {waveRegs.length}/{actualCap} taken</span>
                                                      {w.duration && <span style={{ fontSize: '0.68rem', opacity: 0.7, paddingLeft: '1.1rem' }}>📅 {w.duration}</span>}
                                                    </div>
                                                    <span style={isPast ? { color: 'var(--ft-danger)', fontWeight: 600 } : rem <= 0 ? { color: 'var(--ft-danger)', fontWeight: 600 } : { color: 'var(--ft-success)', fontWeight: 600 }}>
                                                      {isPast ? `Passed${actualRem < 0 ? ` +${Math.abs(actualRem)} overloaded` : ''}` : (rem > 0 ? `${rem} left` : (rem < 0 ? `Full (+${Math.abs(rem)} overloaded)` : 'Full'))}
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          ) : (
                                            <div style={{ paddingLeft: '0.75rem', color: 'var(--ft-text-muted)', fontSize: '0.74rem' }}>
                                              No waves configured.
                                            </div>
                                          )}
                                        </div>
                                      );
                                    });
                                  } else if (place.waves && place.waves.length > 0) {
                                    return place.waves.map(w => {
                                      const waveRegs = registrations?.filter(r => r.placeId === place.id && r.waveId === w.id && r.status !== 'failed' && !r.isTest) || [];
                                      const isPast = w.deadline ? new Date(w.deadline) < now : false;
                                      const cap = isPast ? 0 : (parseInt(w.capacity) || 0);
                                      const rem = cap - waveRegs.length;
                                      const actualCap = parseInt(w.capacity) || 0;
                                      const actualRem = actualCap - waveRegs.length;
                                      return (
                                        <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ft-text-secondary)', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span>🌊 {w.name}: {waveRegs.length}/{actualCap} taken</span>
                                            {w.duration && <span style={{ fontSize: '0.7rem', opacity: 0.7, paddingLeft: '1.1rem' }}>📅 {w.duration}</span>}
                                          </div>
                                          <span style={isPast ? { color: 'var(--ft-danger)', fontWeight: 600 } : rem <= 0 ? { color: 'var(--ft-danger)', fontWeight: 600 } : { color: 'var(--ft-success)', fontWeight: 600 }}>
                                            {isPast ? `Passed${actualRem < 0 ? ` +${Math.abs(actualRem)} overloaded` : ''}` : (rem > 0 ? `${rem} left` : (rem < 0 ? `Full (+${Math.abs(rem)} overloaded)` : 'Full'))}
                                          </span>
                                        </div>
                                      );
                                    });
                                  } else {
                                    const cap = parseInt(place.capacity) || 0;
                                    const rem = cap - regCount;
                                    return (
                                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ft-text-secondary)' }}>
                                        <span>No program or wave configurations.</span>
                                        <span style={rem <= 0 ? { color: 'var(--ft-danger)', fontWeight: 600 } : { color: 'var(--ft-success)', fontWeight: 600 }}>
                                          {rem > 0 ? `${rem} left` : (rem < 0 ? `Full (+${Math.abs(rem)} overloaded)` : 'Full')}
                                        </span>
                                      </div>
                                    );
                                  }
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td><span className="ft-badge" style={{ background: 'var(--ft-primary-bg)', color: 'var(--ft-primary)' }}>{place.department || '—'}</span></td>
                      <td><span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>{place.creditHours || 0}h</span></td>
                      <td>
                        <span style={{ color: regCount > totalCapacity ? 'var(--ft-danger)' : 'inherit', fontWeight: regCount > totalCapacity ? 700 : 'normal' }}>
                          {regCount}
                        </span>
                        {totalCapacity ? `/${totalCapacity}` : ''}
                        {regCount > totalCapacity && (
                          <span style={{ color: 'var(--ft-danger)', fontSize: '0.7rem', marginLeft: '0.25rem', fontWeight: 700 }}>
                            (+{regCount - totalCapacity})
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>
                        {assignedTrainers.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            {assignedTrainers.map(t => <div key={t.id} style={{ whiteSpace: 'nowrap' }}>{t.name}</div>)}
                          </div>
                        ) : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button className="ft-btn ft-btn-ghost ft-btn-icon ft-btn-sm" onClick={() => openEditModal(place)} title="Edit">
                            <Pencil size={15} />
                          </button>
                          <button className="ft-btn ft-btn-ghost ft-btn-icon ft-btn-sm" onClick={() => setConfirmDelete(place.id)} title="Delete" style={{ color: 'var(--ft-danger)' }}>
                            <Trash2 size={15} />
                          </button>
                          <button className="ft-btn ft-btn-ghost ft-btn-icon ft-btn-sm" onClick={() => handleOpenImportModal(place.id)} title="Upload / Import Trainees CSV" style={{ color: 'var(--ft-primary)' }} disabled={importing}>
                            <Upload size={15} />
                          </button>
                          <button className="ft-btn ft-btn-ghost ft-btn-icon ft-btn-sm" onClick={() => exportPlaceCSV(place)} title="Download Registrations CSV" style={{ color: 'var(--ft-primary)' }}>
                            <Download size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (() => {
        const place = places.find(p => p.id === importingPlaceId);
        if (!place) return null;
        return (
          <div className="ft-modal-overlay">
            <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
              <div className="ft-modal-header">
                <h3 className="ft-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  📥 Import Trainees (CSV)
                </h3>
                <button 
                  type="button" 
                  className="ft-btn ft-btn-ghost ft-btn-icon" 
                  onClick={() => setShowImportModal(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="ft-modal-body" style={{ padding: '1.5rem' }}>
                <p style={{ color: 'var(--ft-text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 1.5rem 0' }}>
                  Upload a CSV file to manually register students to <strong>{place.name}</strong>. The file must contain column headers for: <strong>University ID</strong> and <strong>Wave</strong> (both required).
                  {place.hasPrograms && place.programs && place.programs.length > 1 && (
                    <>
                      {' '}Also, since this place offers multiple training programs, a <strong>Program</strong> column is <strong>required</strong>.
                    </>
                  )}
                  {' '}Columns for <strong>Name</strong> and <strong>Email</strong> are optional — student details will be auto-filled when their accounts are created and IDs match.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center', paddingTop: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="ft-btn ft-btn-secondary"
                    onClick={() => downloadImportTemplate(place)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    📥 Download Template
                  </button>
                  <button
                    type="button"
                    className="ft-btn ft-btn-primary"
                    onClick={handleSelectCSVFile}
                    disabled={importing}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#0d9488', borderColor: '#0d9488' }}
                  >
                    {importing ? 'Processing...' : '📤 Upload CSV File'}
                  </button>
                  {importing && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--ft-text-muted)', fontWeight: 500 }}>
                      Processing student list...
                    </span>
                  )}
                </div>
              </div>
              <div className="ft-modal-footer" style={{ borderTop: '1px solid var(--ft-border-light)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '1rem 1.5rem' }}>
                <button 
                  type="button" 
                  className="ft-btn ft-btn-secondary" 
                  onClick={() => setShowImportModal(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="ft-modal-overlay">
          <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="ft-modal-header">
              <h3 className="ft-modal-title">{editingPlace ? '✏️ Edit Place' : '➕ Add New Place'}</h3>
              <button className="ft-btn ft-btn-ghost ft-btn-icon" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="ft-modal-body">
                <div className="ft-input-group">
                  <label className="ft-label">Place Name *</label>
                  <input className="ft-input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. National Research Centre" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="ft-input-group">
                    <label className="ft-label">Credit Hours *</label>
                    <input className="ft-input" type="number" min="0" required value={form.creditHours} onChange={e => setForm(f => ({ ...f, creditHours: e.target.value }))} placeholder="e.g. 30" />
                  </div>
                  <div className="ft-input-group">
                    <label className="ft-label">Department</label>
                    <select className="ft-select" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
                      <option value="">All Departments</option>
                      {FT_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                <div className="ft-input-group">
                  <label className="ft-label">Description</label>
                  <textarea className="ft-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the training place, what students will learn..." rows={3} />
                </div>

                <div className="ft-input-group">
                  <label className="ft-label">Training Topics</label>
                  <textarea className="ft-textarea" value={form.thesis} onChange={e => setForm(f => ({ ...f, thesis: e.target.value }))} placeholder="Related training topics..." rows={2} />
                </div>

                <div className="ft-input-group">
                  <label className="ft-label">Requirements</label>
                  <textarea className="ft-textarea" value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} placeholder="Prerequisites or requirements for students..." rows={2} />
                </div>

                <div className="ft-input-group">
                  <label className="ft-label">Assign Trainers</label>
                    <div style={{
                      border: '1.5px solid var(--ft-border)',
                      borderRadius: 'var(--ft-radius)',
                      background: 'var(--ft-bg-input)',
                      maxHeight: '120px',
                      overflowY: 'auto',
                      padding: '0.65rem 0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}>
                      {trainers.map(t => {
                        const isChecked = form.trainerIds?.includes(t.id);
                        return (
                          <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0, fontSize: '0.88rem', fontWeight: 500 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setForm(f => ({ ...f, trainerIds: [...(f.trainerIds || []), t.id] }));
                                } else {
                                  setForm(f => ({ ...f, trainerIds: (f.trainerIds || []).filter(id => id !== t.id) }));
                                }
                              }}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <span>{t.name}</span>
                          </label>
                        );
                      })}
                      {trainers.length === 0 && (
                        <div style={{ color: 'var(--ft-text-muted)', fontSize: '0.82rem', textAlign: 'center' }}>
                          No eligible trainer accounts found.
                        </div>
                      )}
                    </div>
                  </div>

                <div className="ft-input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <input 
                    type="checkbox" 
                    id="isVisible-checkbox" 
                    checked={form.isVisible} 
                    onChange={e => setForm(f => ({ ...f, isVisible: e.target.checked }))} 
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <label htmlFor="isVisible-checkbox" className="ft-label" style={{ margin: 0, cursor: 'pointer', fontWeight: 600 }}>
                    Visible to Students (uncheck to hide place)
                  </label>
                </div>



                {/* Root Place Payment Settings */}
                <div style={{ background: 'var(--ft-bg-card)', border: '1.5px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', padding: '0.85rem', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div className="ft-input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                    <input 
                      type="checkbox" 
                      id="payToRegister-checkbox" 
                      checked={form.payToRegister} 
                      onChange={e => setForm(f => ({ ...f, payToRegister: e.target.checked }))} 
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label htmlFor="payToRegister-checkbox" className="ft-label" style={{ margin: 0, cursor: 'pointer', fontWeight: 600, color: 'var(--ft-primary)' }}>
                      💰 Require Payment for Registration (Place default)
                    </label>
                  </div>
                  {form.payToRegister && (
                    <div className="ft-input-group" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                      <label className="ft-label" style={{ fontSize: '0.78rem' }}>Custom Payment Link *</label>
                      <input 
                        type="url" 
                        required 
                        className="ft-input" 
                        placeholder="https://payment-gateway.com/pay/..." 
                        value={form.paymentLink} 
                        onChange={e => setForm(f => ({ ...f, paymentLink: e.target.value }))} 
                      />
                    </div>
                  )}
                </div>

                 <div className="ft-input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', marginBottom: '1.25rem' }}>
                   <input 
                     type="checkbox" 
                     id="hasPrograms-checkbox" 
                     checked={form.hasPrograms} 
                     onChange={e => setForm(f => ({ ...f, hasPrograms: e.target.checked }))} 
                     style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                   />
                   <label htmlFor="hasPrograms-checkbox" className="ft-label" style={{ margin: 0, cursor: 'pointer', fontWeight: 600, color: 'var(--ft-primary)' }}>
                     Enable Multiple Training Programs for this place
                   </label>
                 </div>

                 {form.hasPrograms ? (
                   /* Programs Section */
                   <div style={{ margin: '1.5rem 0', borderTop: '1px solid var(--ft-border-light)', paddingTop: '1rem' }}>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                       <label className="ft-label" style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--ft-primary)' }}>🎓 Training Programs</label>
                       <button type="button" className="ft-btn ft-btn-secondary ft-btn-sm" onClick={handleAddProgram}>
                         + Add Program
                       </button>
                     </div>

                     {form.programs && form.programs.length > 0 ? (
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                         {form.programs.map((prog, pIdx) => (
                           <div key={prog.id} style={{ background: 'var(--ft-bg-input)', border: '1.5px solid var(--ft-border)', padding: '1.25rem', borderRadius: 'var(--ft-radius-md)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                               <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ft-text)' }}>Program #{pIdx + 1}</span>
                               <button
                                 type="button"
                                 className="ft-btn ft-btn-ghost ft-btn-sm"
                                 style={{ color: 'var(--ft-danger)', padding: '0.2rem 0.5rem', minHeight: 'auto', height: 'auto', background: 'transparent' }}
                                 onClick={() => handleRemoveProgram(prog.id)}
                               >
                                 Remove Program
                               </button>
                             </div>

                             <div className="ft-input-group">
                               <label className="ft-label">Program Name *</label>
                               <input
                                 className="ft-input"
                                 style={{ background: 'var(--ft-bg-card)' }}
                                 required
                                 value={prog.name}
                                 onChange={e => handleUpdateProgram(prog.id, 'name', e.target.value)}
                                 placeholder="e.g. Summer Internship Program"
                               />
                             </div>

                             <div className="ft-input-group">
                               <label className="ft-label">Credit Hours *</label>
                               <input
                                 className="ft-input"
                                 style={{ background: 'var(--ft-bg-card)' }}
                                 type="number"
                                 min="0"
                                 required
                                 value={prog.creditHours}
                                 onChange={e => handleUpdateProgram(prog.id, 'creditHours', e.target.value)}
                                 placeholder="e.g. 80"
                               />
                             </div>

                             <div className="ft-input-group">
                               <label className="ft-label">Program Details / Description</label>
                               <textarea
                                 className="ft-textarea"
                                 style={{ background: 'var(--ft-bg-card)' }}
                                 value={prog.description}
                                 onChange={e => handleUpdateProgram(prog.id, 'description', e.target.value)}
                                 placeholder="Details about this specific training program..."
                                 rows={2}
                               />
                             </div>

                             {/* Program Payment Settings */}
                             <div style={{ background: 'var(--ft-bg-card)', border: '1px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                               <div className="ft-input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                                 <input 
                                   type="checkbox" 
                                   id={`payToRegister-prog-${prog.id}`} 
                                   checked={prog.payToRegister || false} 
                                   onChange={e => handleUpdateProgram(prog.id, 'payToRegister', e.target.checked)} 
                                   style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                 />
                                 <label htmlFor={`payToRegister-prog-${prog.id}`} className="ft-label" style={{ margin: 0, cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem' }}>
                                   💰 Require Payment for this Program
                                 </label>
                               </div>
                               {prog.payToRegister && (
                                 <div className="ft-input-group" style={{ marginTop: '0.25rem', marginBottom: 0 }}>
                                   <label className="ft-label" style={{ fontSize: '0.74rem' }}>Program Payment Link *</label>
                                   <input 
                                     type="url" 
                                     required 
                                     className="ft-input" 
                                     style={{ background: 'var(--ft-bg-card)', padding: '0.4rem', fontSize: '0.8rem' }}
                                     placeholder="https://payment-gateway.com/pay-program/..." 
                                     value={prog.paymentLink || ''} 
                                     onChange={e => handleUpdateProgram(prog.id, 'paymentLink', e.target.value)} 
                                   />
                                 </div>
                               )}
                             </div>

                             {/* Waves for this program */}
                             <div style={{ borderTop: '1px dashed var(--ft-border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                 <label className="ft-label" style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, color: 'var(--ft-text-secondary)' }}>🌊 Program Waves / Durations</label>
                                 <button type="button" className="ft-btn ft-btn-secondary ft-btn-sm" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }} onClick={() => handleAddProgramWave(prog.id)}>
                                   + Add Wave
                                 </button>
                               </div>

                               {prog.waves && prog.waves.length > 0 ? (
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                                   {prog.waves.map((wave) => (
                                     <div key={wave.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--ft-bg-card)', border: '1px solid var(--ft-border-light)', borderRadius: '4px', padding: '0.75rem', marginBottom: '0.25rem' }}>
                                       <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                         <input
                                           className="ft-input"
                                           style={{ flex: '1.5', padding: '0.4rem', fontSize: '0.82rem', background: 'var(--ft-bg-input)' }}
                                           required
                                           placeholder="Wave Name (e.g. Wave 1)"
                                           value={wave.name}
                                           onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'name', e.target.value)}
                                         />
                                         <input
                                           className="ft-input"
                                           style={{ flex: '1', padding: '0.4rem', fontSize: '0.82rem', background: 'var(--ft-bg-input)' }}
                                           type="number"
                                           min="1"
                                           required
                                           placeholder="Capacity"
                                           value={wave.capacity}
                                           onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'capacity', e.target.value)}
                                         />
                                         <button
                                           type="button"
                                           className="ft-btn ft-btn-ghost ft-btn-icon ft-btn-sm"
                                           style={{ color: 'var(--ft-danger)', flexShrink: 0, width: '28px', height: '28px' }}
                                           onClick={() => handleRemoveProgramWave(prog.id, wave.id)}
                                         >
                                           <Trash2 size={13} />
                                         </button>
                                       </div>
                                       
                                       {/* Specific Date Selectors for Wave Duration */}
                                       <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                         <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                           <span style={{ fontSize: '0.7rem', color: 'var(--ft-text-muted)', fontWeight: 600 }}>Start Date</span>
                                           <input 
                                             type="date" 
                                             className="ft-input" 
                                             style={{ padding: '0.3rem', fontSize: '0.78rem', background: 'var(--ft-bg-input)' }}
                                             value={wave.startDate || ''}
                                             onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'startDate', e.target.value)}
                                           />
                                         </div>
                                         <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                           <span style={{ fontSize: '0.7rem', color: 'var(--ft-text-muted)', fontWeight: 600 }}>End Date</span>
                                           <input 
                                             type="date" 
                                             className="ft-input" 
                                             style={{ padding: '0.3rem', fontSize: '0.78rem', background: 'var(--ft-bg-input)' }}
                                             value={wave.endDate || ''}
                                             onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'endDate', e.target.value)}
                                           />
                                         </div>
                                       </div>
                                       
                                       <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                         {/* Duration display/override */}
                                         <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                           <span style={{ fontSize: '0.7rem', color: 'var(--ft-text-muted)', fontWeight: 600 }}>Duration String</span>
                                           <input 
                                             type="text" 
                                             className="ft-input" 
                                             style={{ padding: '0.3rem', fontSize: '0.78rem', background: 'var(--ft-bg-input)' }}
                                             placeholder="Auto-calculated or custom"
                                             value={wave.duration || ''}
                                             onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'duration', e.target.value)}
                                           />
                                         </div>
                                         {/* Wave-specific Deadline */}
                                         <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                           <span style={{ fontSize: '0.7rem', color: 'var(--ft-text-muted)', fontWeight: 600 }}>📅 Wave Registration Deadline</span>
                                           <input 
                                             type="datetime-local" 
                                             className="ft-input" 
                                             style={{ padding: '0.3rem', fontSize: '0.78rem', background: 'var(--ft-bg-input)' }}
                                             value={wave.deadline || ''}
                                             onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'deadline', e.target.value)}
                                           />
                                         </div>
                                       </div>

                                       {/* Wave Payment settings */}
                                       <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', borderTop: '1px solid var(--ft-border-light)', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                                         <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                           <input 
                                             type="checkbox" 
                                             id={`payToRegister-progwave-${wave.id}`}
                                             checked={wave.payToRegister || false}
                                             onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'payToRegister', e.target.checked)}
                                             style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                                           />
                                           <label htmlFor={`payToRegister-progwave-${wave.id}`} style={{ fontSize: '0.74rem', fontWeight: 600, margin: 0, cursor: 'pointer' }}>
                                             💰 Require Payment for this Wave
                                           </label>
                                         </div>
                                         {wave.payToRegister && (
                                           <input 
                                             type="url"
                                             required
                                             className="ft-input"
                                             placeholder="Wave Custom Payment Link"
                                             style={{ padding: '0.3rem', fontSize: '0.78rem', background: 'var(--ft-bg-input)' }}
                                             value={wave.paymentLink || ''}
                                             onChange={e => handleUpdateProgramWave(prog.id, wave.id, 'paymentLink', e.target.value)}
                                           />
                                         )}
                                       </div>
                                     </div>
                                   ))}
                                 </div>
                               ) : (
                                 <div style={{ fontSize: '0.72rem', color: 'var(--ft-text-muted)', fontStyle: 'italic', padding: '0.2rem 0' }}>
                                   No waves configured for this program.
                                 </div>
                               )}
                             </div>

                           </div>
                         ))}
                       </div>
                     ) : (
                       <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', fontStyle: 'italic', padding: '0.5rem', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius-sm)', textAlign: 'center' }}>
                         No programs created. Click '+ Add Program' to start.
                       </div>
                     )}
                   </div>
                 ) : (
                   /* Standard Waves Section */
                   <div style={{ margin: '1.5rem 0', borderTop: '1px solid var(--ft-border-light)', paddingTop: '1rem' }}>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                       <label className="ft-label" style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--ft-primary)' }}>🌊 Training Waves / Durations</label>
                       <button type="button" className="ft-btn ft-btn-secondary ft-btn-sm" onClick={handleAddWave}>
                         + Add Wave
                       </button>
                     </div>
                     {form.waves && form.waves.length > 0 ? (
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                         {form.waves.map((wave) => (
                           <div key={wave.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--ft-bg-input)', border: '1.5px solid var(--ft-border)', borderRadius: 'var(--ft-radius-sm)', padding: '1rem' }}>
                             <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                               <input
                                 className="ft-input"
                                 style={{ flex: '2', padding: '0.45rem', background: 'var(--ft-bg-card)' }}
                                 required
                                 placeholder="Wave Name"
                                 value={wave.name}
                                 onChange={e => handleUpdateWave(wave.id, 'name', e.target.value)}
                               />
                               <input
                                 className="ft-input"
                                 style={{ flex: '1.2', padding: '0.45rem', background: 'var(--ft-bg-card)' }}
                                 type="number"
                                 min="1"
                                 required
                                 placeholder="Capacity"
                                 value={wave.capacity}
                                 onChange={e => handleUpdateWave(wave.id, 'capacity', e.target.value)}
                               />
                               <button
                                 type="button"
                                 className="ft-btn ft-btn-ghost ft-btn-icon ft-btn-sm"
                                 style={{ color: 'var(--ft-danger)', flexShrink: 0, width: '34px', height: '34px' }}
                                 onClick={() => handleRemoveWave(wave.id)}
                                 title="Remove Wave"
                               >
                                 <Trash2 size={16} />
                               </button>
                             </div>

                             {/* Start/End Dates for Wave Duration */}
                             <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                 <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--ft-text-muted)' }}>Start Date</span>
                                 <input 
                                   type="date" 
                                   className="ft-input" 
                                   style={{ padding: '0.4rem', fontSize: '0.8rem', background: 'var(--ft-bg-card)' }}
                                   value={wave.startDate || ''}
                                   onChange={e => handleUpdateWave(wave.id, 'startDate', e.target.value)}
                                 />
                               </div>
                               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                 <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--ft-text-muted)' }}>End Date</span>
                                 <input 
                                   type="date" 
                                   className="ft-input" 
                                   style={{ padding: '0.4rem', fontSize: '0.8rem', background: 'var(--ft-bg-card)' }}
                                   value={wave.endDate || ''}
                                   onChange={e => handleUpdateWave(wave.id, 'endDate', e.target.value)}
                                 />
                               </div>
                             </div>

                             <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                               {/* Duration string display/override */}
                               <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                 <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--ft-text-muted)' }}>Duration String</span>
                                 <input
                                   className="ft-input"
                                   style={{ padding: '0.4rem', fontSize: '0.8rem', background: 'var(--ft-bg-card)' }}
                                   placeholder="Auto-calculated or custom"
                                   value={wave.duration}
                                   onChange={e => handleUpdateWave(wave.id, 'duration', e.target.value)}
                                 />
                               </div>

                               {/* Wave Deadline */}
                               <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                 <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--ft-text-muted)' }}>📅 Wave Registration Deadline</span>
                                 <input 
                                   type="datetime-local" 
                                   className="ft-input" 
                                   style={{ padding: '0.4rem', fontSize: '0.8rem', background: 'var(--ft-bg-card)' }}
                                   value={wave.deadline || ''}
                                   onChange={e => handleUpdateWave(wave.id, 'deadline', e.target.value)}
                                 />
                               </div>
                             </div>

                             {/* Standard Wave Payment settings */}
                             <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid var(--ft-border-light)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                               <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                 <input 
                                   type="checkbox" 
                                   id={`payToRegister-wave-${wave.id}`}
                                   checked={wave.payToRegister || false}
                                   onChange={e => handleUpdateWave(wave.id, 'payToRegister', e.target.checked)}
                                   style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                 />
                                 <label htmlFor={`payToRegister-wave-${wave.id}`} style={{ fontSize: '0.78rem', fontWeight: 600, margin: 0, cursor: 'pointer' }}>
                                   💰 Require Payment for this Wave
                                 </label>
                               </div>
                               {wave.payToRegister && (
                                 <input 
                                   type="url"
                                   required
                                   className="ft-input"
                                   placeholder="Wave Custom Payment Link"
                                   style={{ padding: '0.4rem', fontSize: '0.8rem', background: 'var(--ft-bg-card)' }}
                                   value={wave.paymentLink || ''}
                                   onChange={e => handleUpdateWave(wave.id, 'paymentLink', e.target.value)}
                                 />
                               )}
                             </div>
                           </div>
                         ))}
                       </div>
                     ) : (
                       <div style={{ fontSize: '0.78rem', color: 'var(--ft-text-muted)', fontStyle: 'italic', padding: '0.25rem 0' }}>
                         No waves configured. Place will use global capacity.
                       </div>
                     )}
                   </div>
                 )}

                <div className="ft-input-group">
                  <label className="ft-label">Image</label>
                  {form.image && (
                    <div style={{ marginBottom: '0.5rem', borderRadius: 'var(--ft-radius)', overflow: 'hidden', height: '120px' }}>
                      <img src={form.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <label className="ft-btn ft-btn-secondary ft-btn-sm" style={{ cursor: 'pointer' }}>
                    <Upload size={15} /> Upload Image
                    <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>

              <div className="ft-modal-footer">
                <button type="button" className="ft-btn ft-btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="ft-btn ft-btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : editingPlace ? 'Save Changes' : 'Add Place'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enrolled Students Modal */}
      {showEnrolledModal && (() => {
        const place = places.find(p => p.id === enrolledPlaceId);
        if (!place) return null;
        const enrolledRegs = registrations?.filter(r => r.placeId === place.id && r.status !== 'failed') || [];
        const filteredEnrolledRegs = enrolledRegs.filter(r => {
          const sci = scientists.find(s => 
            (r.studentId && s.id === r.studentId) ||
            (r.studentUniversityId && s.universityId === r.studentUniversityId) ||
            (r.studentEmail && s.email?.toLowerCase() === r.studentEmail.toLowerCase())
          );
          const dispName = sci?.name || r.studentName || 'Imported Trainee (Pending Account)';
          const dispId = sci?.universityId || r.studentUniversityId || '';
          
          if (!enrolledSearch.trim()) return true;
          const searchLower = enrolledSearch.trim().toLowerCase();
          return (
            dispName.toLowerCase().includes(searchLower) ||
            dispId.toLowerCase().includes(searchLower)
          );
        });

        return (
          <div className="ft-modal-overlay">
            <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px', width: '95%' }}>
              <div className="ft-modal-header">
                <h3 className="ft-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  👥 Enrolled Students ({enrolledRegs.length})
                </h3>
                <button 
                  type="button" 
                  className="ft-btn ft-btn-ghost ft-btn-icon" 
                  onClick={() => { setShowEnrolledModal(false); setEnrolledPlaceId(null); }}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="ft-modal-body" style={{ padding: '1.5rem', maxHeight: '450px', overflowY: 'auto' }}>
                <div style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--ft-text-secondary)' }}>
                  Place: <strong style={{ color: 'var(--ft-text)' }}>{place.name}</strong>
                </div>

                <div style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div className="ft-search-input-wrapper" style={{ flex: 1 }}>
                    <Search size={18} />
                    <input 
                      type="text" 
                      placeholder="Search by student name or ID..." 
                      value={enrolledSearch} 
                      disabled={enrolledRegs.length === 0}
                      onChange={e => setEnrolledSearch(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className={`ft-btn ${showEnrollForm ? 'ft-btn-secondary' : 'ft-btn-primary'}`}
                    onClick={() => {
                      setShowEnrollForm(!showEnrollForm);
                      if (showEnrollForm) {
                        setEnrollStudentId('');
                        setEnrollStudentName('');
                        setEnrollStudentEmail('');
                        setEnrollStudentDept('');
                        setEnrollWaveId('');
                        setEnrollProgramId('');
                        setShowSuggestions(false);
                      }
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}
                  >
                    {showEnrollForm ? 'Cancel' : '➕ Enroll Student'}
                  </button>
                </div>

                {showEnrollForm && (
                  <div className="ft-card" style={{ background: 'var(--ft-bg-input)', border: '1.5px solid var(--ft-border)', padding: '1rem', borderRadius: 'var(--ft-radius-lg)', marginBottom: '1.25rem' }}>
                    <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.92rem', fontWeight: 700, marginBottom: '0.85rem', color: 'var(--ft-text)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      📝 Manual Trainee Enrollment
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div className="ft-input-group" style={{ margin: 0, position: 'relative' }}>
                        <label className="ft-label" style={{ fontSize: '0.75rem' }}>Student ID Number *</label>
                        <input 
                          type="text" 
                          className="ft-input" 
                          placeholder="e.g. 23100571" 
                          value={enrollStudentId}
                          onChange={e => {
                            const val = e.target.value;
                            setEnrollStudentId(val);
                            if (val.trim().length >= 2) {
                              setShowSuggestions(true);
                            } else {
                              setShowSuggestions(false);
                            }
                            const exact = scientists.find(s => s.universityId === val.trim());
                            if (exact) {
                              setEnrollStudentName(exact.name || '');
                              setEnrollStudentEmail(exact.email || '');
                              setEnrollStudentDept(exact.department || '');
                            }
                          }}
                          style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}
                        />

                        {showSuggestions && (() => {
                          const query = enrollStudentId.trim().toLowerCase();
                          const matches = scientists.filter(s => 
                            (s.role === 'student' || s.role === 'user' || !s.role) && 
                            ((s.universityId || '').toLowerCase().includes(query) || (s.name || '').toLowerCase().includes(query))
                          ).slice(0, 5);
                          
                          if (matches.length === 0) return null;
                          
                          return (
                            <div className="ft-suggestions-list">
                              {matches.map(s => (
                                <div 
                                  key={s.id} 
                                  className="ft-suggestions-item"
                                  onClick={() => {
                                    setEnrollStudentId(s.universityId || '');
                                    setEnrollStudentName(s.name || '');
                                    setEnrollStudentEmail(s.email || '');
                                    setEnrollStudentDept(s.department || '');
                                    setShowSuggestions(false);
                                  }}
                                >
                                  <div className="ft-suggestions-item-name">{s.name || 'No Name'}</div>
                                  <div className="ft-suggestions-item-sub">ID: {s.universityId} · {s.department || 'No Dept'}</div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="ft-input-group" style={{ margin: 0 }}>
                        <label className="ft-label" style={{ fontSize: '0.75rem' }}>Student Name (optional)</label>
                        <input 
                          type="text" 
                          className="ft-input" 
                          placeholder="e.g. John Doe" 
                          value={enrollStudentName}
                          onChange={e => setEnrollStudentName(e.target.value)}
                          style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div className="ft-input-group" style={{ margin: 0 }}>
                        <label className="ft-label" style={{ fontSize: '0.75rem' }}>Student Email (optional)</label>
                        <input 
                          type="email" 
                          className="ft-input" 
                          placeholder="e.g. student@aiu.edu.eg" 
                          value={enrollStudentEmail}
                          onChange={e => setEnrollStudentEmail(e.target.value)}
                          style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}
                        />
                      </div>

                      <div className="ft-input-group" style={{ margin: 0 }}>
                        <label className="ft-label" style={{ fontSize: '0.75rem' }}>Student Department (optional)</label>
                        <input 
                          type="text" 
                          className="ft-input" 
                          placeholder="e.g. Biotechnology" 
                          value={enrollStudentDept}
                          onChange={e => setEnrollStudentDept(e.target.value)}
                          style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                      {place.hasPrograms && place.programs && place.programs.length > 0 && (
                        <div className="ft-input-group" style={{ margin: 0 }}>
                          <label className="ft-label" style={{ fontSize: '0.75rem' }}>Select Program</label>
                          <select
                            className="ft-select"
                            value={enrollProgramId}
                            onChange={e => {
                              setEnrollProgramId(e.target.value);
                              setEnrollWaveId('');
                            }}
                            style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem', height: '36px' }}
                          >
                            <option value="">-- Direct Enrollment (No Program) --</option>
                            {place.programs.map(p => (
                              <option key={p.id} value={p.id}>{p.name} ({p.creditHours}h)</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(() => {
                        const availableWaves = place.hasPrograms
                          ? place.programs?.find(p => p.id === enrollProgramId)?.waves
                          : place.waves;
                        
                        if (!availableWaves || availableWaves.length === 0) return null;
                        
                        return (
                          <div className="ft-input-group" style={{ margin: 0 }}>
                            <label className="ft-label" style={{ fontSize: '0.75rem' }}>Select Training Wave</label>
                            <select
                              className="ft-select"
                              value={enrollWaveId}
                              onChange={e => setEnrollWaveId(e.target.value)}
                              style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem', height: '36px' }}
                            >
                              <option value="">-- Direct Enrollment (No Wave) --</option>
                              {availableWaves.map(w => (
                                <option key={w.id} value={w.id}>{w.name} ({w.duration})</option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                      <button 
                        type="button" 
                        className="ft-btn ft-btn-secondary ft-btn-sm" 
                        onClick={() => {
                          setShowEnrollForm(false);
                          setEnrollStudentId('');
                          setEnrollStudentName('');
                          setEnrollStudentEmail('');
                          setEnrollStudentDept('');
                          setEnrollWaveId('');
                          setEnrollProgramId('');
                          setShowSuggestions(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button 
                        type="button" 
                        className="ft-btn ft-btn-primary ft-btn-sm"
                        onClick={() => handleManualEnroll(place)}
                      >
                        🚀 Add Trainee
                      </button>
                    </div>
                  </div>
                )}

                {enrolledRegs.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ft-text-muted)', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius)', fontSize: '0.88rem' }}>
                    👥 No students currently enrolled in this training place. Click "Enroll Student" above to manually add one!
                  </div>
                ) : filteredEnrolledRegs.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ft-text-muted)', background: 'var(--ft-bg-input)', borderRadius: 'var(--ft-radius)', fontSize: '0.88rem' }}>
                    🔍 No students matched your search.
                  </div>
                ) : (
                  <div className="ft-table-wrapper" style={{ margin: 0, border: '1.5px solid var(--ft-border)', width: '100%', overflowX: 'auto' }}>
                    <table className="ft-table" style={{ fontSize: '0.85rem' }}>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>ID / Dept</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Wave / Program</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Status</th>
                          <th style={{ width: '60px', textAlign: 'center' }}>Remove</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEnrolledRegs.map(reg => {
                          const sci = scientists.find(s => 
                            (reg.studentId && s.id === reg.studentId) ||
                            (reg.studentUniversityId && s.universityId === reg.studentUniversityId) ||
                            (reg.studentEmail && s.email?.toLowerCase() === reg.studentEmail.toLowerCase())
                          );
                          const dispName = sci?.name || reg.studentName || 'Imported Trainee (Pending Account)';
                          const dispEmail = sci?.email || reg.studentEmail || '';
                          const dispId = sci?.universityId || reg.studentUniversityId || '—';
                          const dispDept = sci?.department || reg.studentDepartment || '—';

                          return (
                            <tr key={reg.id}>
                              <td>
                                <div style={{ fontWeight: 600, color: 'var(--ft-text)' }}>
                                  {dispName} {reg.isTest && <span style={{ color: 'var(--ft-primary)', fontSize: '0.72rem', background: 'var(--ft-primary-bg)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Test</span>}
                                </div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--ft-text-muted)' }}>{dispEmail}</div>
                              </td>
                              <td>
                                <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--ft-primary)' }}>{dispId}</div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--ft-text-secondary)' }}>{dispDept}</div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ fontWeight: 500 }}>🌊 {cleanWaveName(reg.waveName) || 'Global Capacity'}</div>
                                {reg.programName && <div style={{ fontSize: '0.74rem', color: 'var(--ft-text-secondary)' }}>🎓 {reg.programName}</div>}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <span className={`ft-badge ft-badge-${reg.status}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem', whiteSpace: 'nowrap' }}>
                                  {FT_REG_STATUS_ICONS[reg.status]} {FT_REG_STATUS_LABELS[reg.status]}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button 
                                  className="ft-btn ft-btn-ghost ft-btn-icon ft-btn-sm" 
                                  style={{ color: 'var(--ft-danger)' }}
                                  onClick={() => handleRemoveEnrollment(reg)}
                                  title="Remove Student Enrollment"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="ft-modal-footer" style={{ borderTop: '1px solid var(--ft-border-light)', display: 'flex', justifyContent: 'flex-end', padding: '1rem 1.5rem' }}>
                <button 
                  type="button" 
                  className="ft-btn ft-btn-secondary" 
                  onClick={() => { setShowEnrolledModal(false); setEnrolledPlaceId(null); }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Enrollment Confirm Modal */}
      {confirmDeleteEnrollmentReg && (() => {
        const place = places.find(p => p.id === confirmDeleteEnrollmentReg.placeId);
        const reg = confirmDeleteEnrollmentReg;
        return (
          <div className="ft-modal-overlay" style={{ zIndex: 2100 }}>
            <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
              <div className="ft-modal-body" style={{ textAlign: 'center', padding: '2.5rem 2rem 2rem' }}>
                <div style={{ fontSize: '3.5rem', marginBottom: '1rem', lineHeight: 1 }}>⚠️</div>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--ft-text)' }}>Remove Enrollment?</h3>
                <p style={{ fontSize: '0.88rem', color: 'var(--ft-text-secondary)', marginBottom: '1.75rem', lineHeight: 1.5 }}>
                  Are you sure you want to permanently remove trainee <strong style={{ color: 'var(--ft-text)' }}>{reg.studentName || 'Imported Trainee'}</strong> (ID: {reg.studentUniversityId || '—'}) from <strong style={{ color: 'var(--ft-text)' }}>{place?.name || 'this place'}</strong>? This action cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="ft-btn ft-btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmDeleteEnrollmentReg(null)}>Cancel</button>
                  <button className="ft-btn ft-btn-danger" style={{ flex: 1 }} onClick={async () => {
                    setConfirmDeleteEnrollmentReg(null);
                    try {
                      await db.ft_registrations.delete(reg.id);
                      setToast({ type: 'success', msg: `Successfully removed enrollment for ${reg.studentName || 'student'}.` });
                    } catch (err) {
                      setToast({ type: 'error', msg: 'Failed to remove enrollment: ' + err.message });
                    }
                    setTimeout(() => setToast(null), 3000);
                  }}>Remove</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Confirm Modal */}
      {confirmDelete && (
        <div className="ft-modal-overlay">
          <div className="ft-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="ft-modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", marginBottom: '0.5rem' }}>Delete Place?</h3>
              <p style={{ color: 'var(--ft-text-muted)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
                This action cannot be undone. All student registrations for this place will remain in the system.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button className="ft-btn ft-btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button className="ft-btn ft-btn-danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for CSV Import */}
      <input
        type="file"
        id="bulk-import-csv"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleCSVImport}
        disabled={importing}
      />

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
