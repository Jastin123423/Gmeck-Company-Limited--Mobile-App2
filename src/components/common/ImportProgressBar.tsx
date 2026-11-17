import React from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import type { ImportProgressInfo, ImportProgressStage } from '../../services/excelImportService';

interface ImportProgressBarProps {
  progress: ImportProgressInfo | null;
  phaseLabel?: string;
}

const STAGE_META: Record<
  ImportProgressStage,
  { label: string; badgeClass: string; barClass: string }
> = {
  READING: {
    label: 'Reading File',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    barClass: 'from-sky-500 to-blue-500',
  },
  PARSING: {
    label: 'Parsing Rows',
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    barClass: 'from-blue-500 to-indigo-500',
  },
  VALIDATING: {
    label: 'Validating Data',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    barClass: 'from-blue-500 to-emerald-500',
  },
  SAVING: {
    label: 'Saving Records',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    barClass: 'from-emerald-500 to-teal-400',
  },
  COMPLETE: {
    label: 'Complete',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    barClass: 'from-emerald-500 to-emerald-400',
  },
};

export const ImportProgressBar: React.FC<ImportProgressBarProps> = ({
  progress,
  phaseLabel,
}) => {
  const safePercent = progress
    ? Math.max(0, Math.min(100, Math.round(progress.percent)))
    : 5;
  const stage: ImportProgressStage = progress?.stage || 'READING';
  const meta = STAGE_META[stage];
  const isComplete = stage === 'COMPLETE' && safePercent >= 100;

  return (
    <div
      className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2.5"
      role="progressbar"
      aria-valuenow={safePercent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isComplete ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
          )}
          <span
            className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider shrink-0 ${meta.badgeClass}`}
          >
            {phaseLabel || meta.label}
          </span>
        </div>

        <div className="text-right shrink-0">
          <span className="text-lg font-extrabold text-white font-mono tabular-nums leading-none">
            {safePercent}%
          </span>
        </div>
      </div>

      <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${meta.barClass} transition-all duration-200 ease-out`}
          style={{ width: `${safePercent}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="truncate">{progress?.message || 'Preparing spreadsheet...'}</span>
        {progress && progress.totalRows > 0 && (
          <span className="font-mono tabular-nums text-slate-300 shrink-0">
            {progress.processedRows.toLocaleString()} / {progress.totalRows.toLocaleString()} rows
          </span>
        )}
      </div>
    </div>
  );
};
