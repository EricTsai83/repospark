type LogoProps = {
  size?: number;
  className?: string;
  /** When true, renders the expressive hero variant with a soft halo + shimmer. */
  hero?: boolean;
};

const VB = 256;
const RADIUS = 56;

// 游標：尖端右上，整個形狀沿 45° 對角線 (右上↔左下) 完美對稱
// 對稱意味著：任一點 (x, y) 在鏡像後對應點為 (256-y, 256-x)（對角線為 y = 256-x）
// 尖端: (216, 40) → 鏡像 (216, 40) ✓ (在對角線上)
// 左端外: (40, 112) ↔ 下端外: (144, 216)   [256-112=144, 256-40=216]
// 左端內: (40, 128) ↔ 下端內: (128, 216)   [256-128=128, 256-40=216]
// 凹點: (p, q) 要在對角線上 → q = 256-p，取 (112, 144)
const CURSOR_PATH = [
  'M 216 40',
  'L 40 112',
  'Q 24 120 40 128',
  'L 112 144',
  'L 128 216',
  'Q 136 232 144 216',
  'L 216 40',
  'Z',
].join(' ');

export function Logo({ size = 36, className, hero = false }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VB} ${VB}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Architect Agent logo"
      className={className}
    >
      {hero ? <circle cx={VB / 2} cy={VB / 2} r={VB / 2 - 4} fill="url(#aaLogoHalo)" /> : null}

      <g clipPath="url(#aaLogoClip)">
        {/* 左下紅 / 右上藍，沿左上→右下對角線切分 */}
        <path d={`M0 0 L0 ${VB} L${VB} ${VB} Z`} fill="url(#aaLogoPink)" />
        <path d={`M0 0 L${VB} ${VB} L${VB} 0 Z`} fill="url(#aaLogoBlue)" />

        {/* Cursor 游標：尖端指向右上，直接在目標座標系繪製 */}
        <path d={CURSOR_PATH} fill="currentColor" />
      </g>

      {hero ? <HeroShimmer /> : null}

      <defs>
        <clipPath id="aaLogoClip">
          <rect width={VB} height={VB} rx={RADIUS} />
        </clipPath>
        <linearGradient id="aaLogoPink" x1="0" y1={VB} x2={VB} y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF3B6B" />
          <stop offset="1" stopColor="#B8154A" />
        </linearGradient>
        <linearGradient id="aaLogoBlue" x1={VB} y1="0" x2="0" y2={VB} gradientUnits="userSpaceOnUse">
          <stop stopColor="#3BC8FF" />
          <stop offset="1" stopColor="#1E5BE6" />
        </linearGradient>
        {hero ? <HeroDefs /> : null}
      </defs>
    </svg>
  );
}

function HeroShimmer() {
  return (
    <rect width={VB} height={VB} rx={RADIUS} fill="url(#aaLogoShimmer)" opacity="0.6">
      <animateTransform
        attributeName="transform"
        type="translate"
        from={`-${VB} 0`}
        to={`${VB} 0`}
        dur="6s"
        repeatCount="indefinite"
      />
    </rect>
  );
}

function HeroDefs() {
  return (
    <>
      <radialGradient
        id="aaLogoHalo"
        cx="0"
        cy="0"
        r="1"
        gradientUnits="userSpaceOnUse"
        gradientTransform={`translate(${VB / 2} ${VB / 2}) scale(${VB / 2 - 4})`}
      >
        <stop stopColor="#FFFFFF" stopOpacity="0.18" />
        <stop offset="0.6" stopColor="#FFFFFF" stopOpacity="0.04" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="aaLogoShimmer" x1="0" y1="0" x2={VB} y2={VB} gradientUnits="userSpaceOnUse">
        <stop offset="0.35" stopColor="#FFFFFF" stopOpacity="0" />
        <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.08" />
        <stop offset="0.65" stopColor="#FFFFFF" stopOpacity="0" />
      </linearGradient>
    </>
  );
}
