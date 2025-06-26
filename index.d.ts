// index.d.ts - TypeScript definitions for Juris Kit

declare module '@jurisjs/juris-kit' {
  import { FastifyInstance, FastifyServerOptions } from 'fastify';

  // Configuration interfaces
  export interface JurisConfig {
    server?: ServerConfig;
    app?: AppConfig;
    static?: StaticConfig;
    routes?: RoutesConfig;
    build?: BuildConfig;
    development?: DevelopmentConfig;
    production?: ProductionConfig;
    features?: FeaturesConfig;
    hooks?: HooksConfig;
    monitoring?: MonitoringConfig;
    [key: string]: any;
  }

  export interface ServerConfig {
    port?: number | string;
    host?: string;
    fastify?: FastifyServerOptions;
    compression?: CompressionConfig;
  }

  export interface CompressionConfig {
    enabled?: boolean;
    global?: boolean;
    threshold?: number;
    encodings?: string[];
  }

  export interface AppConfig {
    title?: string;
    description?: string;
    lang?: string;
    meta?: MetaConfig;
    initialState?: Record<string, any>;
    components?: ComponentsConfig;
  }

  export interface MetaConfig {
    charset?: string;
    viewport?: string;
    custom?: Array<{ name?: string; property?: string; content: string }>;
  }

  export interface ComponentsConfig {
    autoLoad?: string[];
    headless?: Record<string, HeadlessComponentConfig>;
  }

  export interface HeadlessComponentConfig {
    autoInit?: boolean;
    options?: Record<string, any>;
  }

  export interface StaticConfig {
    public?: StaticDirectoryConfig;
    directories?: StaticDirectoryConfig[];
  }

  export interface StaticDirectoryConfig {
    root: string;
    prefix: string;
    cache?: CacheConfig;
  }

  export interface CacheConfig {
    maxAge?: string;
    immutable?: boolean;
    etag?: boolean;
    lastModified?: boolean;
  }

  export interface RoutesConfig {
    catchAll?: boolean;
    custom?: CustomRoute[];
    pages?: Record<string, PageConfig>;
    exclude?: {
      patterns: RegExp[];
    };
  }

  export interface CustomRoute {
    method: string;
    path: string;
    handler: (request: any, reply: any) => any;
    options?: Record<string, any>;
  }

  export interface PageConfig {
    title?: string;
    meta?: Array<{ name?: string; property?: string; content: string }>;
  }

  export interface BuildConfig {
    outputDir?: string;
    stitcher?: {
      configFile?: string;
      watch?: boolean;
    };
    bundles?: Record<string, BundleConfig>;
  }

  export interface BundleConfig {
    input: string;
    output: string;
    minify?: boolean;
  }

  export interface DevelopmentConfig {
    hotReload?: {
      enabled?: boolean;
      paths?: string[];
      extensions?: string[];
    };
    routes?: CustomRoute[];
    errorHandling?: ErrorHandlingConfig;
  }

  export interface ProductionConfig {
    security?: {
      headers?: Record<string, string>;
    };
    performance?: {
      http2?: boolean;
      cache?: {
        ssrCacheDuration?: number;
        staticAssets?: Record<string, string>;
      };
    };
    errorHandling?: ErrorHandlingConfig;
  }

  export interface ErrorHandlingConfig {
    showStack?: boolean;
    verboseErrors?: boolean;
    customErrorPage?: boolean;
  }

  export interface FeaturesConfig {
    ssr?: boolean;
    compression?: boolean;
    staticServing?: boolean;
    customRoutes?: boolean;
    errorPages?: boolean;
    healthCheck?: boolean;
    metrics?: boolean;
    experimental?: Record<string, boolean>;
  }

  export interface HooksConfig {
    beforeServerStart?: (fastify: FastifyInstance, config: JurisConfig) => Promise<void>;
    afterServerStart?: (fastify: FastifyInstance, config: JurisConfig) => Promise<void>;
    beforeRequest?: (request: any, reply: any, config: JurisConfig) => Promise<void>;
    beforeRender?: (app: JurisApp, route: string, config: JurisConfig) => Promise<void>;
    afterRender?: (html: string, state: any, route: string, config: JurisConfig) => Promise<{ html: string; state: any }>;
  }

  export interface MonitoringConfig {
    healthCheck?: {
      enabled?: boolean;
      path?: string;
      detailed?: boolean;
    };
    metrics?: {
      enabled?: boolean;
      path?: string;
    };
    logging?: LoggingConfig;
  }

  export interface LoggingConfig {
    file?: {
      enabled?: boolean;
      path?: string;
      maxSize?: string;
      maxFiles?: number;
    };
    levels?: Record<string, string>;
  }

  // Core classes
  export class JurisServer {
    constructor(configPath?: string | null);
    config: JurisConfig;
    fastify: FastifyInstance | null;
    app: JurisApp | null;
    
    start(): Promise<void>;
    stop(): Promise<void>;
    reload(): Promise<void>;
  }

  export class Juris {
    constructor(config: JurisAppConfig);
    render(selector: string): void;
    setState(path: string, value: any): void;
    getState(path?: string): any;
    getComponent(name: string): JurisComponent;
    getHeadlessComponent(name: string): { api: any };
  }

  export interface JurisApp extends Juris {
    stateManager: {
      state: Record<string, any>;
      reset(paths: string[]): void;
    };
  }

  export interface JurisAppConfig {
    states?: Record<string, any>;
    headlessComponents?: Record<string, HeadlessComponentDefinition>;
    components?: Record<string, JurisComponent>;
    layout?: any;
  }

  export interface HeadlessComponentDefinition {
    fn: any;
    options?: Record<string, any>;
  }

  export interface JurisComponent {
    state?: string[];
    render(): any;
    [key: string]: any;
  }

  // Factory functions
  export function createApp(initialState?: Record<string, any>): JurisApp;
  export function createServer(config?: JurisConfig | string): JurisServer;

  // Utilities
  export const stitcher: any;
  export const version: string;
  export const name: string;
  export const defaultConfig: JurisConfig;

  // Default export
  const JurisKit: {
    JurisServer: typeof JurisServer;
    Juris: typeof Juris;
    createApp: typeof createApp;
    createServer: typeof createServer;
    stitcher: any;
    version: string;
    name: string;
    defaultConfig: JurisConfig;
  };

  export default JurisKit;
}