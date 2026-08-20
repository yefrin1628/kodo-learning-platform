import { plainToInstance } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumberString, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

/**
 * Only the variables the running API actually reads at request time —
 * SHADOW_DATABASE_URL etc. are migration-time concerns for `prisma migrate`,
 * not something this process needs to boot. Fails fast with one clear error
 * listing everything wrong, instead of the app starting "successfully" and
 * then failing confusingly the first time something reaches, say, JWT
 * signing with an undefined secret.
 */
class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET debe ser largo y aleatorio (mínimo 32 caracteres) — nunca el valor de ejemplo.' })
  JWT_ACCESS_SECRET!: string;

  @IsOptional()
  @IsNumberString()
  PORT?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES?: string;

  @IsOptional()
  @IsNumberString()
  JWT_REFRESH_EXPIRES_DAYS?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  RUN_EXECUTION_ENABLED?: string;

  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  // Opcional a propósito: sin ella, la subida de avatares responde 503 en
  // vez de romper el boot — permite seguir desarrollando localmente antes
  // de haber conectado el Blob store en este entorno (ver avatar.service.ts).
  @IsOptional()
  @IsString()
  BLOB_READ_WRITE_TOKEN?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new Error(`Variables de entorno inválidas o faltantes:\n- ${messages.join('\n- ')}`);
  }
  return validated;
}
