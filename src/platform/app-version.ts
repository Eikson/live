declare const __APP_VERSION__: string | undefined;

/** Version aus package.json (per Vite eingesetzt); in Tests ohne Vite "0.0.0". */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
