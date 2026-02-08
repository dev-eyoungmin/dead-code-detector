import type { AnalysisResult, ConfidenceLevel } from '../types';

/**
 * Filter analysis results by confidence threshold.
 * Only keeps results at or above the given threshold level.
 */
export function filterByConfidence(
  result: AnalysisResult,
  threshold: ConfidenceLevel
): AnalysisResult {
  const confidenceLevels: ConfidenceLevel[] = ['low', 'medium', 'high'];
  const thresholdIndex = confidenceLevels.indexOf(threshold);

  const meetsThreshold = (confidence: ConfidenceLevel): boolean => {
    const index = confidenceLevels.indexOf(confidence);
    return index >= thresholdIndex;
  };

  return {
    ...result,
    unusedFiles: result.unusedFiles.filter((f) => meetsThreshold(f.confidence)),
    unusedExports: result.unusedExports.filter((e) => meetsThreshold(e.confidence)),
    unusedLocals: result.unusedLocals.filter((l) => meetsThreshold(l.confidence)),
  };
}
