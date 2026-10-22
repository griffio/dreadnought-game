import { limitsToRecord, tierFromFftMs, type GpuContext, type QualityTier } from '../gpu-device';
import { runFftBench, type FftBenchResult } from './fft-bench';
import { guarded, type CheckResult } from './gpu-util';
import { checkHdrMsaaResolve, checkMsaaDepthResolve } from './msaa-depth';
import { runDispatchStress } from './stress';

export interface ProbeReport {
  when: string;
  userAgent: string;
  secureContext: boolean;
  devicePixelRatio: number;
  screen: { width: number; height: number };
  /** iPadOS Safari sends a desktop "Macintosh" UA, so touch support is what tells an iPad from a Mac. */
  input: { maxTouchPoints: number; pointerCoarse: boolean; hardwareConcurrency: number };
  viewport: { width: number; height: number };
  adapter: { vendor: string; architecture: string; device: string; description: string };
  features: string[];
  /** What the adapter could offer. The game requests a default-limits device, see `deviceLimits`. */
  limits: Record<string, number>;
  /** What this session's device actually has (the limits the renderer is designed to). */
  deviceLimits: Record<string, number>;
  checks: Record<string, CheckResult>;
  fft: Record<string, FftBenchResult | { error: string }>;
  suggestedTier: QualityTier;
  gpuErrors: string[];
}

/** Ocean workloads per tier: A = 3 cascades @256^2, B = 3 cascades @128^2, with 4 packed complex fields each. */
const FFT_CONFIGS = [
  { key: 'tierA_256x12', n: 256, jobs: 12 },
  { key: 'tierB_128x12', n: 128, jobs: 12 },
] as const;

export async function runProbe(gpu: GpuContext, log: (line: string) => void): Promise<ProbeReport> {
  const { device, adapter } = gpu;
  const report: ProbeReport = {
    when: new Date().toISOString(),
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: screen.width, height: screen.height },
    input: {
      maxTouchPoints: navigator.maxTouchPoints,
      pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    adapter: {
      vendor: gpu.adapterInfo.vendor,
      architecture: gpu.adapterInfo.architecture,
      device: gpu.adapterInfo.device,
      description: gpu.adapterInfo.description,
    },
    features: [...gpu.features].sort(),
    limits: limitsToRecord(adapter.limits),
    deviceLimits: limitsToRecord(device.limits),
    checks: {},
    fft: {},
    suggestedTier: 'C',
    gpuErrors: gpu.errors,
  };
  log(`adapter: ${JSON.stringify(report.adapter)}`);
  log(`features: ${report.features.join(', ') || '(none)'}`);

  const runCheck = async (name: string, fn: () => Promise<CheckResult>) => {
    log(`running ${name}...`);
    const result = await guarded(device, fn);
    report.checks[name] = result;
    log(`${result.ok ? 'PASS' : 'FAIL'} ${name}: ${result.detail}`);
  };

  await runCheck('msaa-depth-resolve', () => checkMsaaDepthResolve(device));
  await runCheck('hdr-msaa-resolve', () => checkHdrMsaaResolve(device));
  await runCheck('dispatch-stress-600', () => runDispatchStress(device, 600));

  for (const { key, n, jobs } of FFT_CONFIGS) {
    log(`running fft ${n}x${n} x${jobs}...`);
    try {
      device.pushErrorScope('validation');
      const result = await runFftBench(device, n, jobs);
      const err = await device.popErrorScope();
      if (err) {
        report.fft[key] = { error: err.message };
        log(`FAIL fft ${key}: ${err.message}`);
        continue;
      }
      report.fft[key] = result;
      log(
        `${result.correct ? 'PASS' : 'FAIL'} fft ${key}: ${result.pipelinedMs.toFixed(2)} ms/frame pipelined, ` +
          `${result.serialMs.toFixed(2)} ms/frame serial, ${result.dispatchesPerFrame} dispatches, max error ${result.maxError.toExponential(2)}`,
      );
    } catch (e) {
      report.fft[key] = { error: String(e) };
      log(`FAIL fft ${key}: ${String(e)}`);
    }
  }

  const a = report.fft['tierA_256x12'];
  const b = report.fft['tierB_128x12'];
  if (a && 'pipelinedMs' in a && a.correct) report.suggestedTier = tierFromFftMs(a.pipelinedMs);
  else if (b && 'pipelinedMs' in b && b.correct) report.suggestedTier = tierFromFftMs(b.pipelinedMs) === 'A' ? 'B' : 'C';
  log(`suggested tier (provisional thresholds): ${report.suggestedTier}`);
  return report;
}
