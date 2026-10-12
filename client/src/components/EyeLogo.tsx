import { useId } from 'react';

/**
 * Логотип NexusCRM — «глаз».
 * Взгляд ходит влево → вправо → в центр, периодически моргает.
 * Анимация задана CSS-классами .eye-look и .eye-blink (см. index.css).
 */
export default function EyeLogo({ size = 40, animated = true, className = '' }: { size?: number; animated?: boolean; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `eyeGrad-${uid}`;
  const clipId = `eyeClip-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      role="img"
      aria-label="NexusCRM"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#17255e" />
          <stop offset="45%" stopColor="#5b2ba8" />
          <stop offset="78%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#22a1dd" />
        </linearGradient>
        <clipPath id={clipId}>
          <circle cx="60" cy="60" r="27" />
        </clipPath>
      </defs>

      {/* Внешний диск и тонкое кольцо */}
      <circle cx="60" cy="60" r="57" fill={`url(#${gradId})`} />
      <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(244,244,255,0.9)" strokeWidth="2.4" />

      {/* Спутники-кружки по периметру */}
      <g fill="#0d1c40" stroke="rgba(244,244,255,0.9)" strokeWidth="2.4">
        <circle cx="60" cy="14.5" r="8" />
        <circle cx="21.5" cy="90" r="8" />
        <circle cx="98.5" cy="90" r="8" />
      </g>

      {/* Глаз: радужка + зрачок; моргает целиком, зрачок ходит внутри клипа */}
      <g className={animated ? 'eye-blink' : undefined} style={{ transformOrigin: '60px 60px' }}>
        <circle cx="60" cy="60" r="27" fill="#0a1834" stroke="rgba(244,244,255,0.92)" strokeWidth="3" />
        <g clipPath={`url(#${clipId})`}>
          <g className={animated ? 'eye-look' : undefined} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <circle cx="60" cy="60" r="14" fill="#132a5c" />
            <circle cx="54" cy="66" r="7.5" fill="#f4f4ff" />
            <circle cx="68.5" cy="51" r="5" fill="#f4f4ff" />
          </g>
        </g>
      </g>
    </svg>
  );
}
