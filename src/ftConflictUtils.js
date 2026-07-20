export const getWaveDates = (wave) => {
  if (!wave) return null;
  if (wave.startDate && wave.endDate) {
    return {
      start: new Date(wave.startDate),
      end: new Date(wave.endDate)
    };
  }
  if (wave.duration) {
    const parts = wave.duration.split(/\s+to\s+/i);
    if (parts.length === 2) {
      const parsePart = (p) => {
        const match = p.match(/(\d{1,2})\/(\d{1,2})/);
        if (match) {
          const day = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1;
          const year = 2026;
          return new Date(year, month, day);
        }
        return null;
      };
      const start = parsePart(parts[0]);
      const end = parsePart(parts[1]);
      if (start && end) {
        return { start, end };
      }
    }
  }
  return null;
};

export const areDatesOverlapping = (start1, end1, start2, end2) => {
  if (!start1 || !end1 || !start2 || !end2) return false;
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();
  if (isNaN(s1) || isNaN(e1) || isNaN(s2) || isNaN(e2)) return false;
  return s1 <= e2 && s2 <= e1;
};

export const getUserConflicts = (userId, registrations, places) => {
  if (!userId || !registrations || !places) return [];
  // Filter active/pending registrations
  const activeRegs = registrations.filter(r => 
    r.studentId === userId && 
    (r.status === 'active' || r.status === 'pending' || r.status === 'completed')
  );

  const resolved = [];
  activeRegs.forEach(reg => {
    const place = places.find(p => p.id === reg.placeId);
    if (!place) return;

    let wave = null;
    if (place.hasPrograms && place.programs) {
      const prog = place.programs.find(p => p.id === reg.programId);
      if (prog && prog.waves) {
        wave = prog.waves.find(w => w.id === reg.waveId);
      }
    } else if (place.waves) {
      wave = place.waves.find(w => w.id === reg.waveId);
    }

    if (wave) {
      const dates = getWaveDates(wave);
      if (dates) {
        resolved.push({
          reg,
          place,
          wave,
          dates
        });
      }
    }
  });

  const conflicts = [];
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const r1 = resolved[i];
      const r2 = resolved[j];
      if (areDatesOverlapping(r1.dates.start, r1.dates.end, r2.dates.start, r2.dates.end)) {
        conflicts.push({
          reg1: r1.reg,
          reg2: r2.reg,
          place1: r1.place,
          place2: r2.place,
          wave1: r1.wave,
          wave2: r2.wave,
          dates1: r1.dates,
          dates2: r2.dates
        });
      }
    }
  }
  return conflicts;
};

export const getAlternativeWaves = (targetPlace, targetProgramId, registrations, places, userId) => {
  if (!targetPlace) return [];
  const alternatives = [];
  
  // Find all student's OTHER active/pending registrations that are NOT for this place
  const otherRegs = registrations ? registrations.filter(r => 
    r.studentId === userId && 
    r.placeId !== targetPlace.id &&
    (r.status === 'active' || r.status === 'pending' || r.status === 'completed')
  ) : [];

  const otherResolvedDates = [];
  otherRegs.forEach(reg => {
    const p = places.find(pl => pl.id === reg.placeId);
    if (!p) return;
    let w = null;
    if (p.hasPrograms && p.programs) {
      const pr = p.programs.find(prog => prog.id === reg.programId);
      if (pr && pr.waves) {
        w = pr.waves.find(wave => wave.id === reg.waveId);
      }
    } else if (p.waves) {
      w = p.waves.find(wave => wave.id === reg.waveId);
    }
    if (w) {
      const dates = getWaveDates(w);
      if (dates) otherResolvedDates.push(dates);
    }
  });

  // Helper to count seats taken
  const getSeatsTaken = (waveId) => {
    return registrations ? registrations.filter(r => r.waveId === waveId && r.status !== 'failed' && !r.isTest).length : 0;
  };

  const checkWave = (wave, progId = null) => {
    const isPast = wave.deadline ? new Date(wave.deadline) < new Date() : false;
    const taken = getSeatsTaken(wave.id);
    const capacity = wave.capacity || 0;
    const isFull = taken >= capacity;

    if (isPast || isFull) return;

    // Check if this wave conflicts with any of the other active registrations
    const wDates = getWaveDates(wave);
    if (wDates) {
      const hasConflict = otherResolvedDates.some(od => 
        areDatesOverlapping(wDates.start, wDates.end, od.start, od.end)
      );
      if (!hasConflict) {
        alternatives.push({
          wave,
          progId,
          seatsLeft: capacity - taken
        });
      }
    }
  };

  if (targetPlace.hasPrograms && targetPlace.programs) {
    const prog = targetPlace.programs.find(p => p.id === targetProgramId);
    if (prog && prog.waves) {
      prog.waves.forEach(w => checkWave(w, prog.id));
    }
  } else if (targetPlace.waves) {
    targetPlace.waves.forEach(w => checkWave(w));
  }

  return alternatives;
};
