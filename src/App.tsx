import React, { useState, useEffect } from 'react';
import {
  BirthdayItem,
  ClassEvent,
  DayKey,
  DutiesStore,
  HomeworkStore,
  Language,
  PollData,
  PollStatus,
  ProfileKey,
  ScheduleProfiles,
  ScreenType,
  Theme
} from './types';
import {
  DEFAULT_SCHEDULES,
  INITIAL_BIRTHDAYS,
  INITIAL_DUTIES,
  INITIAL_HW,
  SCHEDULE_VERSION,
  SUBJECT_DB
} from './defaultData';
import { initTelegramApp, haptic, tg, getTelegramUserName, sendNotification } from './telegram';
import { Topbar } from './Topbar';
import { HomeView } from './HomeView';
import { ScheduleView } from './ScheduleView';
import { HomeworkView } from './HomeworkView';
import { CanteenView } from './CanteenView';
import { EventsView } from './EventsView';
import { DutiesView } from './DutiesView';
import { BirthdaysView } from './BirthdaysView';
import { SettingsView } from './SettingsView';
import { parseAndNormalizeSchedule, extractSubjectKey, getNextSchoolDay, getNextLessonDate, parseLocalDate, formatLocalDateToYYYYMMDD, getValidProfileKeys, sanitizeScheduleProfiles } from './dateFormatter';
import { translate, getProfileFullTitle, translateZoneName, getStudentDisplayName, STUDENT_NAME_TRANSLATIONS } from './i18n';
import { Users, Calendar } from 'lucide-react';
import { subscribeToDoc, updateDocData } from './firebase';

export function sanitizeBirthdaysList(rawList: any[]): BirthdayItem[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter(b => b && (b.name || b.nameRu) && !String(b.name || '').includes('Иванова') && !String(b.name || '').includes('Каверзникова') && !String(b.name || '').includes('Рыбарт'))
    .map(b => {
      let name = String(b.name || b.nameRu || '').trim();
      if (name.includes(',')) {
        name = name.split(',')[0].trim();
      }
      if (name.toLowerCase() === 'пациёнок дима' || name.toLowerCase() === 'пацыёнак дзіма' || name.toLowerCase() === 'пацыенак дзіма') {
        name = 'Пациенок Дима';
      }
      return {
        name,
        date: String(b.date || '').trim()
      };
    });
}

export default function App() {
  // Telegram setup
  useEffect(() => {
    initTelegramApp();
  }, []);

  // Persistent State
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('ierihon_lang');
    if (saved === 'ru' || saved === 'be') return saved;
    if (tg?.initDataUnsafe?.user?.language_code === 'be') return 'be';
    return 'ru';
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('ierihon_theme') as Theme;
    if (saved === 'light') return 'light';
    return 'dark';
  });

  const handleSetTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('ierihon_theme', newTheme);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);

    const themeColors: Record<Theme, { header: string; bg: string }> = {
      dark: { header: '#0f0f0f', bg: '#0a0a0a' },
      light: { header: '#ffffff', bg: '#f3f4f6' }
    };

    const cfg = themeColors[theme] || themeColors.dark;

    try {
      if (tg) {
        if (tg.setHeaderColor) tg.setHeaderColor(cfg.header);
        if (tg.setBackgroundColor) tg.setBackgroundColor(cfg.bg);
      }
    } catch (e) {
      // ignore
    }
  }, [theme]);

  const [userProfile, setUserProfile] = useState<ProfileKey>(() => {
    const saved = localStorage.getItem('ierihon_profile');
    if (saved === 'math' || saved === 'chem') return saved;
    return 'math';
  });

  // Transient viewing profiles for Homework and Schedule tabs
  const [hwProfile, setHwProfile] = useState<ProfileKey>(userProfile);
  const [scheduleProfile, setScheduleProfile] = useState<ProfileKey>(userProfile);

  const getTodayDayKey = (): DayKey => {
    const day = new Date().getDay();
    const dayMap: DayKey[] = ['pn', 'pn', 'vt', 'sr', 'cht', 'pt', 'pn'];
    return dayMap[day] || 'pn';
  };

  const [activeDay, setActiveDay] = useState<DayKey>(getTodayDayKey);
  const [activeHwDay, setActiveHwDay] = useState<DayKey>(getTodayDayKey);
  const [activeDutyDay, setActiveDutyDay] = useState<DayKey>(getTodayDayKey);
  const [activeSubjectKey, setActiveSubjectKey] = useState<string>('math');

  // Schedules
  const [schedules, setSchedules] = useState<ScheduleProfiles>(() => {
    const saved = localStorage.getItem('ierihon_schedules');
    const savedVer = localStorage.getItem('ierihon_schedules_ver');
    if (saved && savedVer === SCHEDULE_VERSION) {
      try {
        const parsed = JSON.parse(saved);
        return sanitizeScheduleProfiles(parsed);
      } catch (e) { /* ignore */ }
    }
    localStorage.setItem('ierihon_schedules', JSON.stringify(DEFAULT_SCHEDULES));
    localStorage.setItem('ierihon_schedules_ver', SCHEDULE_VERSION);
    return DEFAULT_SCHEDULES;
  });

  useEffect(() => {
    const validKeys = getValidProfileKeys(schedules);
    if (!validKeys.includes(userProfile)) {
      setUserProfile(validKeys[0] || 'math');
    }
    if (!validKeys.includes(hwProfile)) {
      setHwProfile(validKeys[0] || 'math');
    }
    if (!validKeys.includes(scheduleProfile)) {
      setScheduleProfile(validKeys[0] || 'math');
    }
  }, [schedules, userProfile, hwProfile, scheduleProfile]);

  // Homework
  const [homework, setHomework] = useState<HomeworkStore>(() => {
    const saved = localStorage.getItem('ierihon_homework');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return INITIAL_HW;
  });

  // Duties
  const [duties, setDuties] = useState<DutiesStore>(() => {
    const saved = localStorage.getItem('ierihon_duties');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.pn)) {
          return parsed;
        }
      } catch (e) { /* ignore */ }
    }
    return INITIAL_DUTIES;
  });

  // Birthdays
  const [birthdays, setBirthdays] = useState<BirthdayItem[]>(() => {
    const saved = localStorage.getItem('ierihon_birthdays');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = sanitizeBirthdaysList(parsed);
          if (cleaned.length > 0) return cleaned;
        }
      } catch (e) { /* ignore */ }
    }
    return sanitizeBirthdaysList(INITIAL_BIRTHDAYS);
  });

  // Events
  const [events, setEvents] = useState<ClassEvent[]>(() => {
    const saved = localStorage.getItem('ierihon_events');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [
      {
        id: '1',
        title: 'Классный час',
        date: formatLocalDateToYYYYMMDD(new Date()),
        time: '14:40'
      }
    ];
  });

  // Polls
  const [isPollActive, setIsPollActive] = useState<boolean>(() => {
    const active = localStorage.getItem('ierihon_poll_active');
    if (active !== null) return active === 'true';
    const savedPoll = localStorage.getItem('ierihon_current_poll');
    if (savedPoll) {
      try {
        const p = JSON.parse(savedPoll);
        return Boolean(p && p.id && p.id !== 'poll_init' && p.date);
      } catch (e) {}
    }
    return false;
  });

  const [pollHistory, setPollHistory] = useState<PollData[]>(() => {
    const saved = localStorage.getItem('ierihon_poll_history');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });

  const [currentPoll, setCurrentPoll] = useState<PollData>(() => {
    const saved = localStorage.getItem('ierihon_current_poll');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id && parsed.id !== 'poll_init' && parsed.date) {
          return parsed;
        }
      } catch (e) { /* ignore */ }
    }
    const savedHistory = localStorage.getItem('ierihon_poll_history');
    if (savedHistory) {
      try {
        const parsedHist = JSON.parse(savedHistory);
        if (Array.isArray(parsedHist) && parsedHist.length > 0 && parsedHist[0].id) {
          return parsedHist[0];
        }
      } catch (e) { /* ignore */ }
    }
    const today = new Date();
    return {
      id: 'poll_init',
      created: formatLocalDateToYYYYMMDD(today),
      date: formatLocalDateToYYYYMMDD(getNextSchoolDay(today)),
      eat: 0,
      no: 0,
      abs: 0,
      voters: []
    };
  });

  const [birthdaysNotified, setBirthdaysNotified] = useState<{
    lastNotifiedDate?: string;
  }>(() => ({
    lastNotifiedDate: localStorage.getItem('ierihon_last_bday_notified') || ''
  }));

  const [tgConfig, setTgConfig] = useState<{
    token: string;
    chatId: string;
    appUrl?: string;
    autoDelete?: boolean;
    deleteDelay?: number;
  }>(() => ({
    token: localStorage.getItem('ierihon_tg_token') || '',
    chatId: localStorage.getItem('ierihon_tg_chat_id') || '',
    appUrl: (() => {
      const stored = localStorage.getItem('ierihon_tg_app_url');
      if (stored && !stored.includes('ierihon_testbot') && !stored.includes('workers.dev')) {
        return stored;
      }
      return 'https://t.me/Ierihon_chat_bot/Ierihon';
    })(),
    autoDelete: localStorage.getItem('ierihon_tg_auto_delete') !== 'false',
    deleteDelay: Number(localStorage.getItem('ierihon_tg_delete_delay')) || 30
  }));

  // Real-time Firebase Synchronization across devices
  useEffect(() => {
    // 1. Critical immediate subscriptions (main screen & settings)
    const unsubSchedules = subscribeToDoc<any>(
      'schedules',
      data => {
        if (data && typeof data === 'object') {
          const hasStrayKeys = '_version' in data || 'base' in data;
          const isOutdated = data._version && data._version !== SCHEDULE_VERSION;
          const chemCht = data?.chem?.cht;
          const needsChemThursdayFix = Array.isArray(chemCht) && (
            chemCht.some((lesson: string) => lesson.toLowerCase().includes('геометр') && lesson.startsWith('3')) ||
            chemCht.length < 7
          );

          const sanitized = isOutdated ? DEFAULT_SCHEDULES : sanitizeScheduleProfiles(data);
          setSchedules(sanitized);
          localStorage.setItem('ierihon_schedules', JSON.stringify(sanitized));
          localStorage.setItem('ierihon_schedules_ver', SCHEDULE_VERSION);

          // If the Firestore document has _version, base, or needs Thursday chem fix, write back the clean object!
          if (hasStrayKeys || isOutdated || needsChemThursdayFix) {
            updateDocData('schedules', sanitized);
          }
        }
      },
      () => {
        updateDocData('schedules', DEFAULT_SCHEDULES);
      }
    );
    const unsubTgConfig = subscribeToDoc<{
      token: string;
      chatId: string;
      appUrl?: string;
      autoDelete?: boolean;
      deleteDelay?: number;
    }>(
      'tgConfig',
      data => {
        if (data && typeof data === 'object') {
          setTgConfig(data);
          if (data.token) localStorage.setItem('ierihon_tg_token', data.token);
          if (data.chatId) localStorage.setItem('ierihon_tg_chat_id', data.chatId);
          if (data.appUrl && !data.appUrl.includes('ierihon_testbot') && !data.appUrl.includes('workers.dev')) {
            localStorage.setItem('ierihon_tg_app_url', data.appUrl);
          } else {
            localStorage.setItem('ierihon_tg_app_url', 'https://t.me/Ierihon_chat_bot/Ierihon');
          }
          if (data.autoDelete !== undefined) localStorage.setItem('ierihon_tg_auto_delete', String(data.autoDelete));
          if (data.deleteDelay !== undefined) localStorage.setItem('ierihon_tg_delete_delay', String(data.deleteDelay));
        }
      },
      () => updateDocData('tgConfig', tgConfig)
    );
    const unsubHomework = subscribeToDoc<HomeworkStore>(
      'homework',
      data => { if (data && typeof data === 'object') setHomework(data); },
      () => updateDocData('homework', homework)
    );
    const unsubPoll = subscribeToDoc<PollData>(
      'currentPoll',
      data => {
        if (data && typeof data === 'object' && data.id && data.id !== 'poll_init' && data.date) {
          setCurrentPoll(data);
          setIsPollActive(true);
          setSelectedPollDetail(prev => (prev && prev.id === data.id ? data : prev));
          setPollHistory(prev => {
            const list = Array.isArray(prev) ? prev : [];
            const idx = list.findIndex(p => p.id === data.id || (data.date && p.date === data.date));
            if (idx >= 0) {
              const copy = [...list];
              copy[idx] = data;
              return copy;
            }
            return [data, ...list];
          });
        }
      }
    );

    const unsubDuties = subscribeToDoc<DutiesStore>(
      'duties',
      data => { if (data && typeof data === 'object') setDuties(data); },
      () => updateDocData('duties', duties)
    );
    const unsubBirthdays = subscribeToDoc<BirthdayItem[]>(
      'birthdays',
      data => {
        if (Array.isArray(data)) {
          const cleaned = sanitizeBirthdaysList(data);
          setBirthdays(cleaned);
          if (JSON.stringify(cleaned) !== JSON.stringify(data)) {
            updateDocData('birthdays', cleaned);
          }
        }
      },
      () => updateDocData('birthdays', birthdays)
    );
    const unsubBirthdaysNotified = subscribeToDoc<{ lastNotifiedDate?: string }>(
      'birthdays_notified',
      data => {
        if (data && typeof data === 'object') {
          setBirthdaysNotified(data);
          if (data.lastNotifiedDate) {
            localStorage.setItem('ierihon_last_bday_notified', data.lastNotifiedDate);
          }
        }
      }
    );
    const unsubEvents = subscribeToDoc<ClassEvent[]>(
      'events',
      data => { if (Array.isArray(data)) setEvents(data); },
      () => updateDocData('events', events)
    );
    const unsubPollHistory = subscribeToDoc<PollData[]>(
      'pollHistory',
      data => {
        if (Array.isArray(data) && data.length > 0) {
          const validPolls = data.filter(p => p && p.id && p.id !== 'poll_init' && p.date);
          validPolls.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

          setPollHistory(validPolls);
          setSelectedPollDetail(prev => {
            if (!prev) return prev;
            const updated = validPolls.find(p => p.id === prev.id);
            return updated || prev;
          });

          // Ensure currentPoll is synchronized with the latest valid poll
          setCurrentPoll(prevCurrent => {
            if (!prevCurrent || !prevCurrent.id || prevCurrent.id === 'poll_init' || !prevCurrent.date) {
              if (validPolls[0]) {
                setIsPollActive(true);
                return validPolls[0];
              }
            }
            const matching = validPolls.find(p => p.id === prevCurrent.id || (prevCurrent.date && p.date === prevCurrent.date));
            if (matching) {
              return matching;
            }
            return prevCurrent;
          });
        }
      }
    );
    const unsubIsPollActive = subscribeToDoc<boolean>(
      'isPollActive',
      data => {
        if (typeof data === 'boolean') {
          setIsPollActive(data);
        }
      }
    );

    return () => {
      unsubSchedules();
      unsubTgConfig();
      unsubHomework();
      unsubPoll();
      unsubDuties();
      unsubBirthdays();
      unsubBirthdaysNotified();
      unsubEvents();
      unsubPollHistory();
      unsubIsPollActive();
    };
  }, []);

  const handleSaveTgConfig = (
    token: string,
    chatId: string,
    appUrl?: string,
    autoDelete?: boolean,
    deleteDelay?: number
  ) => {
    const newConfig = {
      token: token.trim(),
      chatId: chatId.trim(),
      appUrl: appUrl ? appUrl.trim() : 'https://t.me/ierihon_testbot/app',
      autoDelete: autoDelete !== undefined ? autoDelete : true,
      deleteDelay: deleteDelay || 30
    };
    setTgConfig(newConfig);
    localStorage.setItem('ierihon_tg_token', newConfig.token);
    localStorage.setItem('ierihon_tg_chat_id', newConfig.chatId);
    localStorage.setItem('ierihon_tg_app_url', newConfig.appUrl);
    localStorage.setItem('ierihon_tg_auto_delete', String(newConfig.autoDelete));
    localStorage.setItem('ierihon_tg_delete_delay', String(newConfig.deleteDelay));
    updateDocData('tgConfig', newConfig);
  };

  const [selectedPollDetail, setSelectedPollDetail] = useState<PollData | null>(null);
  const [selectedPollDateStr, setSelectedPollDateStr] = useState<string>('');
  const [isEditingPast, setIsEditingPast] = useState<boolean>(false);

  // Navigation Stack
  const [screenHistory, setScreenHistory] = useState<ScreenType[]>(['home']);
  const currentScreen = screenHistory[screenHistory.length - 1];

  // Sync to localStorage as offline fallback
  useEffect(() => {
    localStorage.setItem('ierihon_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('ierihon_profile', userProfile);
  }, [userProfile]);

  useEffect(() => {
    localStorage.setItem('ierihon_schedules', JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    localStorage.setItem('ierihon_homework', JSON.stringify(homework));
  }, [homework]);

  useEffect(() => {
    localStorage.setItem('ierihon_duties', JSON.stringify(duties));
  }, [duties]);

  useEffect(() => {
    localStorage.setItem('ierihon_birthdays', JSON.stringify(birthdays));

    if (birthdays && birthdays.length > 0) {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const todayDDMM = `${day}.${month}`;
      const todayYMD = formatLocalDateToYYYYMMDD(now);

      const localLastNotified = localStorage.getItem('ierihon_last_bday_notified');
      const remoteLastNotified = birthdaysNotified?.lastNotifiedDate;

      if (localLastNotified !== todayYMD && remoteLastNotified !== todayYMD) {
        const todayBirthdays = birthdays.filter(b => {
          if (!b.date || (b.name && b.name.includes('Иванова'))) return false;
          const parts = b.date.trim().split('.');
          if (parts.length >= 2) {
            const d = parts[0].padStart(2, '0');
            const m = parts[1].padStart(2, '0');
            return `${d}.${m}` === todayDDMM;
          }
          return false;
        });

        if (todayBirthdays.length > 0) {
          const names = todayBirthdays.map(b => b.name).join(', ');
          const ruTitle = '🎂 День рождения сегодня!';
          const ruMsg = `Сегодня празднует: ${names}! Поздравляем! 🎉`;
          const beTitle = '🎂 Дзень нараджэння сёння!';
          const beMsg = `Сёння святкуе: ${names}! Віншуем! 🎉`;

          localStorage.setItem('ierihon_last_bday_notified', todayYMD);
          setBirthdaysNotified({ lastNotifiedDate: todayYMD });
          updateDocData('birthdays_notified', {
            lastNotifiedDate: todayYMD,
            notifiedNames: names,
            notifiedAt: new Date().toISOString()
          });

          sendNotification(
            lang === 'be' ? beTitle : ruTitle,
            lang === 'be' ? beMsg : ruMsg,
            ruTitle,
            ruMsg,
            { isBirthday: true }
          );
        }
      }
    }
  }, [birthdays, birthdaysNotified?.lastNotifiedDate]);

  useEffect(() => {
    localStorage.setItem('ierihon_events', JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem('ierihon_poll_active', String(isPollActive));
  }, [isPollActive]);

  useEffect(() => {
    localStorage.setItem('ierihon_poll_history', JSON.stringify(pollHistory));
  }, [pollHistory]);

  useEffect(() => {
    localStorage.setItem('ierihon_current_poll', JSON.stringify(currentPoll));
  }, [currentPoll]);

  // Telegram Back Button Hook
  useEffect(() => {
    if (tg?.BackButton) {
      if (screenHistory.length > 1) {
        tg.BackButton.show();
        const handleTelegramBack = () => handleBack();
        tg.BackButton.onClick(handleTelegramBack);
        return () => {
          tg.BackButton.offClick(handleTelegramBack);
        };
      } else {
        tg.BackButton.hide();
      }
    }
  }, [screenHistory]);

  // Navigation Handlers
  const handleNavigate = (screen: ScreenType) => {
    if (screen === 'hw') {
      setHwProfile(userProfile);
    } else if (screen === 'schedule') {
      setScheduleProfile(userProfile);
    }
    setScreenHistory(prev => [...prev, screen]);
    haptic('light');
  };

  const handleBack = () => {
    if (screenHistory.length <= 1) return;
    const prevHistory = screenHistory.slice(0, screenHistory.length - 1);
    setScreenHistory(prevHistory);
    haptic('light');
  };

  // Language setter
  const handleSetLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('ierihon_lang', newLang);
    haptic('selection');
  };

  // DUTY ZONE HANDLERS (2-level system)
  const handleCreateZone = (dayKey: DayKey, zoneName: string) => {
    const canonicalName = translateZoneName(zoneName.trim(), 'ru');
    setDuties(prev => {
      const dayZones = prev[dayKey] || [];
      const newZone = {
        id: 'zone_' + Date.now(),
        name: canonicalName,
        students: []
      };
      const nextDuties = {
        ...prev,
        [dayKey]: [...dayZones, newZone]
      };
      updateDocData('duties', nextDuties);
      return nextDuties;
    });

    const dayNameRu: Record<DayKey, string> = {
      pn: 'Понедельник',
      vt: 'Вторник',
      sr: 'Среда',
      cht: 'Четверг',
      pt: 'Пятница'
    };
    const dayNameBe: Record<DayKey, string> = {
      pn: 'Панядзелак',
      vt: 'Аўторак',
      sr: 'Серада',
      cht: 'Чацвер',
      pt: 'Пятніца'
    };

    const ruZoneName = translateZoneName(zoneName, 'ru');
    const beZoneName = translateZoneName(zoneName, 'be');

    const ruTitle = '🧹 Новая зона дежурства';
    const ruMsg = `День: ${dayNameRu[dayKey] || dayKey}\nЗона: ${ruZoneName}`;

    const beTitle = '🧹 Новая зона дзяжурства';
    const beMsg = `Дзень: ${dayNameBe[dayKey] || dayKey}\nЗона: ${beZoneName}`;

    sendNotification(
      lang === 'be' ? beTitle : ruTitle,
      lang === 'be' ? beMsg : ruMsg,
      ruTitle,
      ruMsg
    );
  };

  const handleDeleteZone = (dayKey: DayKey, zoneId: string) => {
    setDuties(prev => {
      const dayZones = prev[dayKey] || [];
      const nextDuties = {
        ...prev,
        [dayKey]: dayZones.filter(z => z.id !== zoneId)
      };
      updateDocData('duties', nextDuties);
      return nextDuties;
    });
  };

  const handleAssignStudentToZone = (
    dayKey: DayKey,
    zoneId: string,
    studentName: string
  ) => {
    setDuties(prev => {
      const dayZones = prev[dayKey] || [];
      const updatedZones = dayZones.map(z => {
        if (z.id === zoneId) {
          if (z.students.includes(studentName)) return z;
          return {
            ...z,
            students: [...z.students, studentName]
          };
        }
        return z;
      });
      const nextDuties = {
        ...prev,
        [dayKey]: updatedZones
      };
      updateDocData('duties', nextDuties);
      return nextDuties;
    });
  };

  const handleUpdateZone = (
    dayKey: DayKey,
    zoneId: string,
    newName: string,
    students: string[]
  ) => {
    const canonicalName = translateZoneName(newName.trim(), 'ru');
    setDuties(prev => {
      const dayZones = prev[dayKey] || [];
      const updatedZones = dayZones.map(z => {
        if (z.id === zoneId) {
          return {
            ...z,
            name: canonicalName || z.name,
            students
          };
        }
        return z;
      });
      const nextDuties = {
        ...prev,
        [dayKey]: updatedZones
      };
      updateDocData('duties', nextDuties);
      return nextDuties;
    });
  };

  const handleRemoveStudentFromZone = (
    dayKey: DayKey,
    zoneId: string,
    studentIndex: number
  ) => {
    setDuties(prev => {
      const dayZones = prev[dayKey] || [];
      const updatedZones = dayZones.map(z => {
        if (z.id === zoneId) {
          const nextStudents = [...z.students];
          nextStudents.splice(studentIndex, 1);
          return {
            ...z,
            students: nextStudents
          };
        }
        return z;
      });
      const nextDuties = {
        ...prev,
        [dayKey]: updatedZones
      };
      updateDocData('duties', nextDuties);
      return nextDuties;
    });
  };

  // HOMEWORK HANDLERS
  const handleSaveHomework = (subjectKey: string, text: string, customDueDate?: string) => {
    setHomework(prev => {
      const currentList = prev[subjectKey] || [];
      const baseKey = extractSubjectKey(subjectKey);
      const existingDueDates = currentList.map(item => item.due).filter(Boolean);
      const dueISO = customDueDate || getNextLessonDate(baseKey, schedules, hwProfile, existingDueDates);
      const newItem = {
        id: Date.now().toString(),
        text,
        due: dueISO,
        created: formatLocalDateToYYYYMMDD(new Date())
      };
      const nextHw = {
        ...prev,
        [subjectKey]: [...currentList, newItem]
      };
      updateDocData('homework', nextHw);
      return nextHw;
    });

    const baseKey = extractSubjectKey(subjectKey);
    const dbItem = SUBJECT_DB[baseKey];
    const subjNameRu = dbItem ? dbItem.ru : baseKey;
    const subjNameBe = dbItem ? dbItem.be : baseKey;

    let isProf = false;
    if (baseKey === 'rus_lang') {
      isProf = true;
    } else if (subjectKey.startsWith('prof_') || subjectKey.startsWith('math_') || subjectKey.startsWith('chem_')) {
      isProf = true;
    } else if (subjectKey.startsWith('base_')) {
      isProf = false;
    } else {
      if (['math', 'algebra', 'geometry'].includes(baseKey)) {
        isProf = hwProfile === 'math';
      } else if (baseKey === 'chem') {
        isProf = hwProfile === 'chem';
      }
    }

    const levelRu = isProf ? 'Профильный' : 'Базовый';
    const levelBe = isProf ? 'Прафільны' : 'Базавы';

    const ruTitle = '📚 Новое домашнее задание';
    const ruMsg = `Предмет: ${subjNameRu} (${levelRu})`;

    const beTitle = '📚 Новае дамашняе заданне';
    const beMsg = `Прадмет: ${subjNameBe} (${levelBe})`;

    sendNotification(
      lang === 'be' ? beTitle : ruTitle,
      lang === 'be' ? beMsg : ruMsg,
      ruTitle,
      ruMsg,
      { noPin: true }
    );
  };

  const handleEditHomework = (subjectKey: string, id: string, newText: string) => {
    setHomework(prev => {
      let targetKey = subjectKey;
      if (!prev[targetKey] || !prev[targetKey].some(item => item.id === id)) {
        for (let k in prev) {
          if (prev[k]?.some(item => item.id === id)) {
            targetKey = k;
            break;
          }
        }
      }
      const currentList = prev[targetKey] || [];
      const nextHw = {
        ...prev,
        [targetKey]: currentList.map(item =>
          item.id === id ? { ...item, text: newText } : item
        )
      };
      updateDocData('homework', nextHw);
      return nextHw;
    });
  };

  const handleDeleteHomework = (subjectKey: string, id: string) => {
    setHomework(prev => {
      let targetKey = subjectKey;
      if (!prev[targetKey] || !prev[targetKey].some(item => item.id === id)) {
        for (let k in prev) {
          if (prev[k]?.some(item => item.id === id)) {
            targetKey = k;
            break;
          }
        }
      }
      const currentList = prev[targetKey] || [];
      const nextHw = {
        ...prev,
        [targetKey]: currentList.filter(item => item.id !== id)
      };
      updateDocData('homework', nextHw);
      return nextHw;
    });
  };

  const [toast, setToast] = useState<{ msg: string; type?: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => {
      setToast(prev => (prev?.msg === msg ? null : prev));
    }, 3000);
  };

  const handleClearAllHomework = () => {
    if (confirm(translate('confirm_clear_hw_all', lang))) {
      const emptyHw = {};
      setHomework(emptyHw);
      updateDocData('homework', emptyHw);
      haptic('success');
      showToast(lang === 'be' ? 'Усе заданні ачышчаны.' : 'Все домашние задания очищены.', 'success');
    }
  };

  const handleDeletePoll = (pollId: string) => {
    if (confirm(translate('confirm_delete_poll', lang))) {
      const nextHist = pollHistory.filter(p => p.id !== pollId);
      setPollHistory(nextHist);
      updateDocData('pollHistory', nextHist);
      localStorage.setItem('ierihon_poll_history', JSON.stringify(nextHist));

      if (currentPoll.id === pollId) {
        if (nextHist.length > 0) {
          const nextPoll = nextHist[0];
          setCurrentPoll(nextPoll);
          setIsPollActive(true);
          updateDocData('currentPoll', nextPoll);
          updateDocData('isPollActive', true);
          localStorage.setItem('ierihon_current_poll', JSON.stringify(nextPoll));
          localStorage.setItem('ierihon_poll_active', 'true');
        } else {
          const emptyPoll: PollData = {
            id: '',
            created: '',
            date: '',
            eat: 0,
            no: 0,
            abs: 0,
            voters: []
          };
          setCurrentPoll(emptyPoll);
          setIsPollActive(false);
          updateDocData('currentPoll', emptyPoll);
          updateDocData('isPollActive', false);
          localStorage.setItem('ierihon_current_poll', JSON.stringify(emptyPoll));
          localStorage.setItem('ierihon_poll_active', 'false');
        }
      }

      if (selectedPollDetail && selectedPollDetail.id === pollId) {
        setSelectedPollDetail(null);
      }

      haptic('success');
      showToast(lang === 'be' ? 'Апытанне выдалена!' : 'Опрос удален!', 'success');
    }
  };

  const handleResetSchedule = () => {
    if (confirm(lang === 'be' ? 'Скінуць расклад да пачатковага (стокавага)?' : 'Сбросить расписание до начального (стокового)?')) {
      setSchedules(DEFAULT_SCHEDULES);
      localStorage.setItem('ierihon_schedules', JSON.stringify(DEFAULT_SCHEDULES));
      localStorage.setItem('ierihon_schedules_ver', SCHEDULE_VERSION);
      updateDocData('schedules', DEFAULT_SCHEDULES);
      haptic('success');
      showToast(lang === 'be' ? 'Расклад скінуты да пачатковага!' : 'Расписание сброшено до стокового!', 'success');
    }
  };

  const handleResetBirthdays = () => {
    if (confirm(lang === 'be' ? 'Скінуць спіс дзён нараджэння да пачатковага (стокавага)?' : 'Сбросить список дней рождения до начального (стокового)?')) {
      const stockBirthdays = sanitizeBirthdaysList(INITIAL_BIRTHDAYS);
      setBirthdays(stockBirthdays);
      localStorage.setItem('ierihon_birthdays', JSON.stringify(stockBirthdays));
      updateDocData('birthdays', stockBirthdays);
      haptic('success');
      showToast(lang === 'be' ? 'Спіс дзён нараджэння скінуты!' : 'Список дней рождения сброшен до начального!', 'success');
    }
  };

  const handleClearAllDuties = () => {
    if (confirm(lang === 'be' ? 'Вы ўпэўненыя, што хочаце ачысціць усе дзяжурства?' : 'Вы уверены, что хотите очистить все дежурства?')) {
      const emptyDuties = { zones: [] };
      setDuties(emptyDuties);
      localStorage.setItem('ierihon_duties', JSON.stringify(emptyDuties));
      updateDocData('duties', emptyDuties);
      haptic('success');
      showToast(lang === 'be' ? 'Усе дзяжурствы ачышчаны.' : 'Все дежурства очищены.', 'success');
    }
  };

  const handleClearAllData = () => {
    if (confirm(translate('confirm_clear_all_data', lang))) {
      const emptyHw = {};
      const emptyDuties = { zones: [] };
      const emptyEvents: ClassEvent[] = [];
      const stockBirthdays = sanitizeBirthdaysList(INITIAL_BIRTHDAYS);
      const emptyPoll: PollData = {
        id: '1',
        created: '',
        date: '',
        eat: 0,
        no: 0,
        abs: 0,
        voters: []
      };
      const emptyPollHistory: PollData[] = [];

      setSchedules(DEFAULT_SCHEDULES);
      setUserProfile('math');
      setHwProfile('math');
      setScheduleProfile('math');
      setHomework(emptyHw);
      setDuties(emptyDuties);
      setEvents(emptyEvents);
      setBirthdays(stockBirthdays);
      setCurrentPoll(emptyPoll);
      setPollHistory(emptyPollHistory);
      setIsPollActive(false);

      localStorage.setItem('ierihon_schedules', JSON.stringify(DEFAULT_SCHEDULES));
      localStorage.setItem('ierihon_schedules_ver', SCHEDULE_VERSION);
      localStorage.setItem('ierihon_active_profile', 'math');
      localStorage.setItem('ierihon_profile', 'math');
      localStorage.setItem('ierihon_homework', JSON.stringify(emptyHw));
      localStorage.setItem('ierihon_duties', JSON.stringify(emptyDuties));
      localStorage.setItem('ierihon_events', JSON.stringify(emptyEvents));
      localStorage.setItem('ierihon_birthdays', JSON.stringify(stockBirthdays));
      localStorage.setItem('ierihon_current_poll', JSON.stringify(emptyPoll));
      localStorage.setItem('ierihon_poll_history', JSON.stringify(emptyPollHistory));
      localStorage.setItem('ierihon_poll_active', 'false');

      updateDocData('schedules', DEFAULT_SCHEDULES);
      updateDocData('homework', emptyHw);
      updateDocData('duties', emptyDuties);
      updateDocData('events', emptyEvents);
      updateDocData('birthdays', stockBirthdays);
      updateDocData('currentPoll', emptyPoll);
      updateDocData('pollHistory', emptyPollHistory);
      updateDocData('isPollActive', false);

      haptic('success');
      showToast(lang === 'be' ? 'Усе даныя праграмы ануляваны!' : 'Все данные приложения успешно обнулены!', 'success');
    }
  };

  // CANTEEN POLL HANDLERS
  const handleCreatePoll = (customDate?: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let targetDate = customDate;
    if (!targetDate) {
      const existingPollDates: Date[] = [];
      if (currentPoll && currentPoll.date) {
        const d = parseLocalDate(currentPoll.date);
        if (!isNaN(d.getTime())) existingPollDates.push(d);
      }
      pollHistory.forEach(p => {
        if (p.date) {
          const d = parseLocalDate(p.date);
          if (!isNaN(d.getTime())) existingPollDates.push(d);
        }
      });

      const validFutureDates = existingPollDates.filter(d => d >= today);
      let baseDate = today;
      if (validFutureDates.length > 0) {
        baseDate = new Date(Math.max(...validFutureDates.map(d => d.getTime())));
      }
      const candidate = getNextSchoolDay(baseDate);
      targetDate = formatLocalDateToYYYYMMDD(candidate);
    }

    // Check if an existing poll for this date already exists
    const existingForDate = pollHistory.find(p => p.date === targetDate) || (currentPoll && currentPoll.date === targetDate ? currentPoll : null);

    // Save previous currentPoll to history if it has valid info
    let updatedHistory = [...pollHistory];
    if (currentPoll && currentPoll.date && currentPoll.id && currentPoll.id !== 'poll_init') {
      const idx = updatedHistory.findIndex(p => p.id === currentPoll.id || p.date === currentPoll.date);
      if (idx >= 0) {
        updatedHistory[idx] = { ...currentPoll };
      } else {
        updatedHistory = [{ ...currentPoll }, ...updatedHistory];
      }
    }

    let newPoll: PollData;
    if (existingForDate && Array.isArray(existingForDate.voters) && existingForDate.voters.length > 0) {
      // Re-activate existing poll and keep all votes intact
      newPoll = { ...existingForDate };
    } else {
      newPoll = {
        id: 'poll_' + Date.now(),
        created: formatLocalDateToYYYYMMDD(today),
        date: targetDate,
        eat: 0,
        no: 0,
        abs: 0,
        voters: []
      };
    }

    // Immediately include newPoll at top of history, removing any duplicate
    const finalHistory = [
      newPoll,
      ...updatedHistory.filter(p => p.id !== newPoll.id && p.date !== newPoll.date)
    ];

    setCurrentPoll(newPoll);
    setPollHistory(finalHistory);
    setIsPollActive(true);

    // Persist immediately to localStorage
    localStorage.setItem('ierihon_current_poll', JSON.stringify(newPoll));
    localStorage.setItem('ierihon_poll_history', JSON.stringify(finalHistory));
    localStorage.setItem('ierihon_poll_active', 'true');

    // Persist to Firestore
    updateDocData('currentPoll', newPoll);
    updateDocData('pollHistory', finalHistory);
    updateDocData('isPollActive', true);

    handleNavigate('canteen-poll');
    showToast(lang === 'be' ? 'Апытанне запушчана!' : 'Опрос запущен!', 'success');

    const ruTitle = '🍽️ Новый опрос столовой';
    const ruMsg = 'Запущен опрос на ' + targetDate;
    sendNotification(
      lang === 'be' ? '🍽️ Новае апытанне сталовай' : ruTitle,
      (lang === 'be' ? 'Запушчана апытанне на ' : 'Запущен опрос на ') + targetDate,
      ruTitle,
      ruMsg
    );
  };

  const handleVote = (status: PollStatus) => {
    if (!currentPoll || !currentPoll.id || currentPoll.id === 'poll_init' || !currentPoll.date) return;
    const userName = getTelegramUserName(lang);

    const voters = Array.isArray(currentPoll.voters) ? [...currentPoll.voters] : [];
    const existingIdx = voters.findIndex(v => v.name === userName);

    let newEat = currentPoll.eat || 0;
    let newNo = currentPoll.no || 0;
    let newAbs = currentPoll.abs || 0;

    if (existingIdx >= 0) {
      const oldStatus = voters[existingIdx].status;
      if (oldStatus === status) return; // no change

      if (oldStatus === 'eat' && newEat > 0) newEat--;
      if (oldStatus === 'no' && newNo > 0) newNo--;
      if (oldStatus === 'abs' && newAbs > 0) newAbs--;

      voters[existingIdx] = { name: userName, status };
    } else {
      voters.push({ name: userName, status });
    }

    if (status === 'eat') newEat++;
    if (status === 'no') newNo++;
    if (status === 'abs') newAbs++;

    const updatedPoll: PollData = {
      ...currentPoll,
      eat: newEat,
      no: newNo,
      abs: newAbs,
      voters
    };

    setCurrentPoll(updatedPoll);
    setIsPollActive(true);
    localStorage.setItem('ierihon_current_poll', JSON.stringify(updatedPoll));
    localStorage.setItem('ierihon_poll_active', 'true');
    updateDocData('currentPoll', updatedPoll);
    updateDocData('isPollActive', true);

    // Also update pollHistory safely with prev state to avoid race conditions
    setPollHistory(prev => {
      const currentList = Array.isArray(prev) ? prev : [];
      const idx = currentList.findIndex(p => p.id === updatedPoll.id || (updatedPoll.date && p.date === updatedPoll.date));
      let nextHist: PollData[];
      if (idx >= 0) {
        nextHist = [...currentList];
        nextHist[idx] = updatedPoll;
      } else {
        nextHist = [updatedPoll, ...currentList];
      }
      localStorage.setItem('ierihon_poll_history', JSON.stringify(nextHist));
      updateDocData('pollHistory', nextHist);
      return nextHist;
    });

    if (selectedPollDetail && (selectedPollDetail.id === updatedPoll.id || selectedPollDetail.date === updatedPoll.date)) {
      setSelectedPollDetail(updatedPoll);
    }

    haptic('medium');
  };

  const handleVotePastPoll = (status: PollStatus) => {
    if (!selectedPollDetail || !selectedPollDetail.id) return;
    const userName = getTelegramUserName(lang);

    const voters = Array.isArray(selectedPollDetail.voters) ? [...selectedPollDetail.voters] : [];
    const existingIdx = voters.findIndex(v => v.name === userName);

    let newEat = selectedPollDetail.eat || 0;
    let newNo = selectedPollDetail.no || 0;
    let newAbs = selectedPollDetail.abs || 0;

    if (existingIdx >= 0) {
      const oldStatus = voters[existingIdx].status;
      if (oldStatus === status) return;

      if (oldStatus === 'eat' && newEat > 0) newEat--;
      if (oldStatus === 'no' && newNo > 0) newNo--;
      if (oldStatus === 'abs' && newAbs > 0) newAbs--;

      voters[existingIdx] = { name: userName, status };
    } else {
      voters.push({ name: userName, status });
    }

    if (status === 'eat') newEat++;
    if (status === 'no') newNo++;
    if (status === 'abs') newAbs++;

    const updatedPoll: PollData = {
      ...selectedPollDetail,
      eat: newEat,
      no: newNo,
      abs: newAbs,
      voters
    };

    setSelectedPollDetail(updatedPoll);

    setPollHistory(prev => {
      const currentList = Array.isArray(prev) ? prev : [];
      const updatedHistory = currentList.map(p => (p.id === updatedPoll.id || (p.date && p.date === updatedPoll.date) ? updatedPoll : p));
      localStorage.setItem('ierihon_poll_history', JSON.stringify(updatedHistory));
      updateDocData('pollHistory', updatedHistory);
      return updatedHistory;
    });

    if (currentPoll && (currentPoll.id === updatedPoll.id || currentPoll.date === updatedPoll.date)) {
      setCurrentPoll(updatedPoll);
      localStorage.setItem('ierihon_current_poll', JSON.stringify(updatedPoll));
      updateDocData('currentPoll', updatedPoll);
    }

    haptic('medium');
  };

  // EVENTS HANDLERS
  const handleAddEvent = (title: string, date: string, time: string) => {
    const newEvent: ClassEvent = {
      id: Date.now().toString(),
      title,
      date,
      time
    };
    setEvents(prev => {
      const nextEvents = [...prev, newEvent];
      updateDocData('events', nextEvents);
      return nextEvents;
    });

    const ruTitle = '📅 Новое мероприятие класса';
    const ruMsg = `${title} (${date} ${time})`;
    sendNotification(
      lang === 'be' ? '📅 Новая падзея класа' : ruTitle,
      ruMsg,
      ruTitle,
      ruMsg
    );
  };

  const handleDeleteEvent = (id: string) => {
    setEvents(prev => {
      const nextEvents = prev.filter(e => e.id !== id);
      updateDocData('events', nextEvents);
      return nextEvents;
    });
  };

  // IMPORT HANDLERS
  const handleImportSchedules = (data: any) => {
    try {
      const normalized = parseAndNormalizeSchedule(data);
      setSchedules(normalized);
      updateDocData('schedules', normalized);

      const availKeys = getValidProfileKeys(normalized);
      if (!availKeys.includes(userProfile)) {
        setUserProfile(availKeys[0] || 'math');
      }
      if (!availKeys.includes(hwProfile)) {
        setHwProfile(availKeys[0] || 'math');
      }
      if (!availKeys.includes(scheduleProfile)) {
        setScheduleProfile(availKeys[0] || 'math');
      }

      haptic('success');
      showToast(lang === 'be' ? 'Расклад паспяхова загружаны!' : 'Расписание успешно загружено!', 'success');
    } catch (err: any) {
      showToast(err?.message || (lang === 'be' ? 'Памылка загрузкі распісання' : 'Ошибка при загрузке расписания'), 'error');
      haptic('error');
    }
  };

  const parseJsonData = (data: any) => {
    if (typeof data === 'string') {
      let cleaned = data.trim();
      if (cleaned.charCodeAt(0) === 0xFEFF) cleaned = cleaned.slice(1);
      cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        return JSON.parse(cleaned.replace(/'/g, '"'));
      }
    }
    return data;
  };

  const handleImportHomework = (data: any) => {
    try {
      const parsed = parseJsonData(data);
      if (!parsed || typeof parsed !== 'object') throw new Error('Некорректный файл JSON');
      setHomework(parsed);
      updateDocData('homework', parsed);
      haptic('success');
      showToast(lang === 'be' ? 'Заданні загружаны!' : 'Домашние задания восстановлены!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Ошибка при импорте домашних заданий', 'error');
      haptic('error');
    }
  };

  const handleImportDuties = (data: any) => {
    try {
      const parsed = parseJsonData(data);
      if (!parsed || typeof parsed !== 'object') throw new Error('Некорректный файл JSON');
      setDuties(parsed);
      updateDocData('duties', parsed);
      haptic('success');
      showToast(lang === 'be' ? 'Дзяжурствы загружаны!' : 'График дежурств обновлен!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Ошибка при импорте графика дежурств', 'error');
      haptic('error');
    }
  };

  const handleImportBirthdays = (data: any) => {
    try {
      const parsed = parseJsonData(data);
      if (!Array.isArray(parsed)) throw new Error('Файл дней рождения должен быть массивом');
      const sanitized = sanitizeBirthdaysList(parsed);
      setBirthdays(sanitized);
      updateDocData('birthdays', sanitized);
      haptic('success');
      showToast(lang === 'be' ? 'Дні нараджэння загружаны!' : 'Список дней рождения обновлен!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Ошибка при импорте дней рождения', 'error');
      haptic('error');
    }
  };

  // Handle user preference profile change from Settings
  const handleSetUserProfile = (p: ProfileKey) => {
    setUserProfile(p);
    setHwProfile(p);
    setScheduleProfile(p);
    localStorage.setItem('ierihon_profile', p);
    haptic('selection');
  };

  // Render Screen Content
  const renderScreen = () => {
    switch (currentScreen) {
      case 'home':
        return (
          <HomeView
            birthdays={birthdays}
            schedules={schedules}
            activeProfile={userProfile}
            lang={lang}
            onNavigate={handleNavigate}
          />
        );

      case 'schedule':
        return (
          <ScheduleView
            viewMode="profiles"
            schedules={schedules}
            activeProfile={scheduleProfile}
            activeDay={activeDay}
            lang={lang}
            onSelectProfile={p => {
              setScheduleProfile(p);
              handleNavigate('schedule-days');
            }}
            onSelectDay={setActiveDay}
            onNavigate={handleNavigate}
          />
        );

      case 'schedule-days':
        return (
          <ScheduleView
            viewMode="days"
            schedules={schedules}
            activeProfile={scheduleProfile}
            activeDay={activeDay}
            lang={lang}
            onSelectProfile={setScheduleProfile}
            onSelectDay={setActiveDay}
            onNavigate={handleNavigate}
          />
        );

      case 'hw':
        return (
          <HomeworkView
            viewMode="main"
            homeworkStore={homework}
            schedules={schedules}
            activeProfile={hwProfile}
            activeSubjectKey={activeSubjectKey}
            activeHwDay={activeHwDay}
            lang={lang}
            onSelectProfile={setHwProfile}
            onSelectSubject={setActiveSubjectKey}
            onSelectHwDay={setActiveHwDay}
            onNavigate={handleNavigate}
            onSaveHomework={handleSaveHomework}
            onEditHomework={handleEditHomework}
            onDeleteHomework={handleDeleteHomework}
          />
        );

      case 'hw-subjects':
        return (
          <HomeworkView
            viewMode="subjects"
            homeworkStore={homework}
            schedules={schedules}
            activeProfile={hwProfile}
            activeSubjectKey={activeSubjectKey}
            activeHwDay={activeHwDay}
            lang={lang}
            onSelectProfile={setHwProfile}
            onSelectSubject={setActiveSubjectKey}
            onSelectHwDay={setActiveHwDay}
            onNavigate={handleNavigate}
            onSaveHomework={handleSaveHomework}
            onEditHomework={handleEditHomework}
            onDeleteHomework={handleDeleteHomework}
          />
        );

      case 'hw-detail':
        return (
          <HomeworkView
            viewMode="detail"
            homeworkStore={homework}
            schedules={schedules}
            activeProfile={hwProfile}
            activeSubjectKey={activeSubjectKey}
            activeHwDay={activeHwDay}
            lang={lang}
            onSelectProfile={setHwProfile}
            onSelectSubject={setActiveSubjectKey}
            onSelectHwDay={setActiveHwDay}
            onNavigate={handleNavigate}
            onSaveHomework={handleSaveHomework}
            onEditHomework={handleEditHomework}
            onDeleteHomework={handleDeleteHomework}
          />
        );

      case 'canteen':
        return (
          <CanteenView
            viewMode="menu"
            currentPoll={currentPoll}
            pollHistory={pollHistory}
            isPollActive={isPollActive}
            selectedPollDetail={selectedPollDetail}
            selectedPollDateStr={selectedPollDateStr}
            isEditingPast={isEditingPast}
            lang={lang}
            onNavigate={handleNavigate}
            onCreatePoll={handleCreatePoll}
            onVote={handleVote}
            onSelectPollDetail={(poll, dateStr) => {
              setSelectedPollDetail(poll);
              setSelectedPollDateStr(dateStr);
              setIsEditingPast(false);
            }}
            onToggleEditPast={() => setIsEditingPast(!isEditingPast)}
            onVotePastPoll={handleVotePastPoll}
          />
        );

      case 'canteen-poll':
        return (
          <CanteenView
            viewMode="poll"
            currentPoll={currentPoll}
            pollHistory={pollHistory}
            isPollActive={isPollActive}
            selectedPollDetail={selectedPollDetail}
            selectedPollDateStr={selectedPollDateStr}
            isEditingPast={isEditingPast}
            lang={lang}
            onNavigate={handleNavigate}
            onCreatePoll={handleCreatePoll}
            onVote={handleVote}
            onSelectPollDetail={(poll, dateStr) => {
              setSelectedPollDetail(poll);
              setSelectedPollDateStr(dateStr);
              setIsEditingPast(false);
            }}
            onToggleEditPast={() => setIsEditingPast(!isEditingPast)}
            onVotePastPoll={handleVotePastPoll}
          />
        );

      case 'canteen-history':
        return (
          <CanteenView
            viewMode="history"
            currentPoll={currentPoll}
            pollHistory={pollHistory}
            isPollActive={isPollActive}
            selectedPollDetail={selectedPollDetail}
            selectedPollDateStr={selectedPollDateStr}
            isEditingPast={isEditingPast}
            lang={lang}
            onNavigate={handleNavigate}
            onCreatePoll={handleCreatePoll}
            onVote={handleVote}
            onSelectPollDetail={(poll, dateStr) => {
              setSelectedPollDetail(poll);
              setSelectedPollDateStr(dateStr);
              setIsEditingPast(false);
            }}
            onToggleEditPast={() => setIsEditingPast(!isEditingPast)}
            onVotePastPoll={handleVotePastPoll}
          />
        );

      case 'canteen-result':
        return (
          <CanteenView
            viewMode="result"
            currentPoll={currentPoll}
            pollHistory={pollHistory}
            isPollActive={isPollActive}
            selectedPollDetail={selectedPollDetail}
            selectedPollDateStr={selectedPollDateStr}
            isEditingPast={isEditingPast}
            lang={lang}
            onNavigate={handleNavigate}
            onCreatePoll={handleCreatePoll}
            onVote={handleVote}
            onSelectPollDetail={(poll, dateStr) => {
              setSelectedPollDetail(poll);
              setSelectedPollDateStr(dateStr);
              setIsEditingPast(false);
            }}
            onToggleEditPast={() => setIsEditingPast(!isEditingPast)}
            onVotePastPoll={handleVotePastPoll}
          />
        );

      case 'events':
        return (
          <EventsView
            events={events}
            lang={lang}
            onAddEvent={handleAddEvent}
            onDeleteEvent={handleDeleteEvent}
          />
        );

      case 'class':
        return (
          <div className="space-y-3 animate-fade-in">
            <div
              onClick={() => handleNavigate('duties')}
              className="flex items-center gap-3.5 bg-[#121215] border border-[#27272A] rounded-3xl p-4 cursor-pointer hover:bg-[#18181C] hover:border-zinc-500 transition-all active:scale-[0.99] shadow-sm group"
            >
              <div className="w-10 h-10 rounded-2xl bg-zinc-800 border border-zinc-700 text-white flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white">
                  {translate('duties_title', lang)}
                </div>
                <div className="text-xs text-[#888] mt-0.5">
                  {translate('duties_desc', lang)}
                </div>
              </div>
            </div>

            <div
              onClick={() => handleNavigate('birthdays')}
              className="flex items-center gap-3.5 bg-[#121215] border border-[#27272A] rounded-3xl p-4 cursor-pointer hover:bg-[#18181C] hover:border-zinc-500 transition-all active:scale-[0.99] shadow-sm group"
            >
              <div className="w-10 h-10 rounded-2xl bg-zinc-800 border border-zinc-700 text-white flex items-center justify-center shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white">
                  {translate('birthdays_title', lang)}
                </div>
                <div className="text-xs text-[#888] mt-0.5">
                  {translate('birthdays_desc', lang)}
                </div>
              </div>
            </div>
          </div>
        );

      case 'duties':
        return (
          <DutiesView
            duties={duties}
            birthdays={birthdays}
            activeDay={activeDutyDay}
            lang={lang}
            onSelectDay={setActiveDutyDay}
            onCreateZone={handleCreateZone}
            onDeleteZone={handleDeleteZone}
            onAssignStudent={handleAssignStudentToZone}
            onUpdateZone={handleUpdateZone}
            onRemoveStudent={handleRemoveStudentFromZone}
          />
        );

      case 'birthdays':
        return <BirthdaysView birthdays={birthdays} lang={lang} />;

      case 'settings':
        return (
          <SettingsView
            lang={lang}
            theme={theme}
            schedules={schedules}
            activeProfile={userProfile}
            onSetTheme={handleSetTheme}
            onSetProfile={handleSetUserProfile}
            homework={homework}
            duties={duties}
            birthdays={birthdays}
            currentPoll={currentPoll}
            pollHistory={pollHistory}
            tgConfig={tgConfig}
            onSetLang={handleSetLang}
            onResetSchedule={handleResetSchedule}
            onResetBirthdays={handleResetBirthdays}
            onImportSchedules={handleImportSchedules}
            onImportHomework={handleImportHomework}
            onImportDuties={handleImportDuties}
            onImportBirthdays={handleImportBirthdays}
            onClearAllHomework={handleClearAllHomework}
            onClearAllDuties={handleClearAllDuties}
            onDeletePoll={handleDeletePoll}
            onClearAllData={handleClearAllData}
            onSaveTgConfig={handleSaveTgConfig}
          />
        );

      default:
        return null;
    }
  };

  const getProfileName = (): string => {
    if (currentScreen === 'schedule-days') {
      return getProfileFullTitle(scheduleProfile, schedules, lang);
    }
    if (currentScreen === 'hw' || currentScreen === 'hw-subjects' || currentScreen === 'hw-detail') {
      return getProfileFullTitle(hwProfile, schedules, lang);
    }
    return getProfileFullTitle(userProfile, schedules, lang);
  };

  return (
    <div className="max-w-[500px] mx-auto min-h-screen bg-[#09090B] text-white flex flex-col font-sans pb-safe">
      <Topbar
        currentScreen={currentScreen}
        screenHistory={screenHistory}
        profileName={getProfileName()}
        activeSubjectKey={activeSubjectKey}
        activePollDate={selectedPollDateStr}
        lang={lang}
        onBack={handleBack}
      />

      <main className="flex-1 p-3 pb-6">{renderScreen()}</main>

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#121215] border border-[#27272A] px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold text-white flex items-center gap-2.5 animate-slide-up max-w-[90vw] pointer-events-none">
          <span className="text-base">{toast.type === 'error' ? '❌' : toast.type === 'success' ? '✅' : 'ℹ️'}</span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
