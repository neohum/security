import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Mission {
  id: string;
  category: 'passive-recon' | 'active-scan' | 'target-services' | 'custom-scanner' | string;
  order: number;
  title: string;
  description: string;
  target: string;
  hint: string;
  flag: string;
  aliases?: string[];
  validationPattern: string;
  defenderExplanation: string;
  defenderPatch: string;
}

export interface MissionsData {
  title: string;
  version: string;
  description: string;
  missions: Mission[];
}

export interface DefenderAlert {
  missionId: string;
  title: string;
  target: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  patch: string;
  timestamp: string;
}

export interface EvaluationResult {
  matched: boolean;
  mission?: Mission;
  flagUnlocked?: string;
  matchedBy: 'flag' | 'command' | 'output' | 'none';
  defenderAlert?: DefenderAlert;
  message: string;
}

let cachedMissions: Mission[] | null = null;

function resolveScenarioPath(overridePath?: string): string {
  if (overridePath && fs.existsSync(overridePath)) {
    return overridePath;
  }
  const defaultRelative = path.resolve(process.cwd(), 'scenarios/ch3-missions.json');
  if (fs.existsSync(defaultRelative)) {
    return defaultRelative;
  }

  // Fallback using import.meta.url
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(currentDir, '../scenarios/ch3-missions.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // ignore
  }

  return defaultRelative;
}

export function loadMissions(customPath?: string): Mission[] {
  const filePath = resolveScenarioPath(customPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missions configuration file not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const data: MissionsData = JSON.parse(raw);
  cachedMissions = data.missions || [];
  return cachedMissions;
}

export function getAllMissions(customPath?: string): Mission[] {
  if (!cachedMissions) {
    return loadMissions(customPath);
  }
  return cachedMissions;
}

export function getMissionById(id: string, customPath?: string): Mission | undefined {
  const missions = getAllMissions(customPath);
  const targetId = (id || '').trim().toLowerCase();

  // 1. Direct ID match
  const exact = missions.find(m => m.id.toLowerCase() === targetId);
  if (exact) return exact;

  // 2. Tutorial quest aliases mapping
  if (targetId === 'm4-mssql-login' || targetId === 'quest-mssql-login' || targetId === 'quest-msf-services' || targetId === 'mssql') {
    return missions.find(m => m.id === 'service-mssql-ping-07');
  }
  if (targetId === 'm5-s3-leak' || targetId === 'quest-s3' || targetId === 's3') {
    return missions.find(m => m.id === 'service-s3-bucket-08');
  }
  if (targetId === 'm6-custom-scanner' || targetId === 'quest-custom-scanner' || targetId === 'custom-scanner' || targetId === 'banner') {
    return missions.find(m => m.id === 'custom-scanner-ruby-12');
  }

  // 3. Match against mission aliases
  return missions.find(m => m.aliases?.some(a => a.toLowerCase() === targetId));
}

export function getMissionsByCategory(category: string, customPath?: string): Mission[] {
  const missions = getAllMissions(customPath);
  return missions.filter(m => m.category === category);
}

export function getSeverityForCategory(category: string): 'low' | 'medium' | 'high' | 'critical' {
  switch (category) {
    case 'passive-recon':
      return 'low';
    case 'active-scan':
      return 'medium';
    case 'target-services':
      return 'high';
    case 'custom-scanner':
      return 'critical';
    default:
      return 'medium';
  }
}

export function generateDefenderAlert(mission: Mission): DefenderAlert {
  return {
    missionId: mission.id,
    title: `[탐지 경보] ${mission.title}`,
    target: mission.target,
    severity: getSeverityForCategory(mission.category),
    explanation: mission.defenderExplanation,
    patch: mission.defenderPatch,
    timestamp: new Date().toISOString()
  };
}

/**
 * Validates a flag submission against all available missions.
 * Supports case-insensitivity, leading/trailing whitespace tolerance.
 */
export function evaluateFlag(flagInput: string, customPath?: string): EvaluationResult {
  const trimmed = (flagInput || '').trim();
  if (!trimmed) {
    return {
      matched: false,
      matchedBy: 'none',
      message: '플래그가 비어있습니다.'
    };
  }

  const missions = getAllMissions(customPath);

  for (const mission of missions) {
    const isDirectMatch = mission.flag.toLowerCase() === trimmed.toLowerCase();
    const isAliasMatch = mission.aliases?.some(a => a.toLowerCase() === trimmed.toLowerCase());

    if (isDirectMatch || isAliasMatch) {
      return {
        matched: true,
        mission,
        flagUnlocked: mission.flag,
        matchedBy: 'flag',
        defenderAlert: generateDefenderAlert(mission),
        message: `플래그 검증 성공! [${mission.title}] 퀘스트를 완료했습니다.`
      };
    }
  }

  return {
    matched: false,
    matchedBy: 'none',
    message: '유효하지 않은 플래그입니다.'
  };
}

/**
 * Evaluates terminal command or stdout stream against mission validation regex patterns.
 * Normalizes extra whitespace and supports case-insensitive pattern matching.
 */
export function evaluateCommand(
  command: string,
  stdout?: string,
  customPath?: string
): EvaluationResult[] {
  const missions = getAllMissions(customPath);
  const results: EvaluationResult[] = [];
  const textToScan = `${command || ''}\n${stdout || ''}`;
  const normalizedText = textToScan.replace(/\s+/g, ' ');

  for (const mission of missions) {
    try {
      const regex = new RegExp(mission.validationPattern, 'i');
      if (regex.test(textToScan) || regex.test(normalizedText)) {
        const matchedBy = (command && regex.test(command)) ? 'command' : 'output';
        results.push({
          matched: true,
          mission,
          flagUnlocked: mission.flag,
          matchedBy,
          defenderAlert: generateDefenderAlert(mission),
          message: `패턴 일치 확인: ${mission.title}`
        });
      }
    } catch {
      // Regex parsing fallback
    }
  }

  return results;
}

/**
 * Evaluates user submission for a specific targeted mission.
 * Supports case-insensitive flag check, regex matching, and whitespace tolerance.
 */
export function evaluateSubmission(
  missionId: string,
  input: string,
  customPath?: string
): EvaluationResult {
  const mission = getMissionById(missionId, customPath);
  if (!mission) {
    return {
      matched: false,
      matchedBy: 'none',
      message: `퀘스트 ID '${missionId}'를 찾을 수 없습니다.`
    };
  }

  const trimmed = (input || '').trim();

  // 1. Direct flag check (case-insensitive + aliases)
  const isDirectFlag =
    trimmed.toLowerCase() === mission.flag.toLowerCase() ||
    mission.aliases?.some(a => a.toLowerCase() === trimmed.toLowerCase());

  if (isDirectFlag) {
    return {
      matched: true,
      mission,
      flagUnlocked: mission.flag,
      matchedBy: 'flag',
      defenderAlert: generateDefenderAlert(mission),
      message: `정답 플래그 확인: [${mission.title}] 완료!`
    };
  }

  // 2. Validation Pattern check on command / output
  try {
    const regex = new RegExp(mission.validationPattern, 'i');
    const normalized = trimmed.replace(/\s+/g, ' ');
    if (regex.test(trimmed) || regex.test(normalized)) {
      return {
        matched: true,
        mission,
        flagUnlocked: mission.flag,
        matchedBy: 'output',
        defenderAlert: generateDefenderAlert(mission),
        message: `유효 실행 패턴 확인: [${mission.title}] 완료!`
      };
    }
  } catch {
    // regex failure
  }

  return {
    matched: false,
    mission,
    matchedBy: 'none',
    message: `제출 내용이 퀘스트 [${mission.title}]의 조건과 일치하지 않습니다.`
  };
}
