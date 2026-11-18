import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AVATAR_PRESET } from '../avatar';

/**
 * The profile fields a person may change about themselves. Anything else in
 * the body (plan, verification, account status, two-factor state) is
 * stripped by the validation pipe and never reaches the database.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  /** Accepted only when unchanged: a new address needs its own verification. */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  affiliation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  /** A generated picture, `<style>:<seed>:<hue>` such as `gradient:1234:blue`, or null to drop the current picture (a photo included) and fall back to the one derived from the account. Photos arrive through the upload route, never as a value here. */
  @IsOptional()
  @IsString()
  @Matches(AVATAR_PRESET, { message: 'avatarUrl must be a generated picture such as dither:1234:blue.' })
  avatarUrl?: string | null;
}
