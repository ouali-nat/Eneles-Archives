import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Identifies who is verifying.
 *
 * Login supplies `email`. It must not supply `userId`, because that would mean
 * `POST /auth/login` had told the client the user's id, and by extension that
 * the account exists. Signup supplies a negative `userId` (the pending-signup
 * handle), which is fine: signup already knows the address is new.
 *
 * Exactly one of the two is required.
 */
export class VerifyLoginDto {
  @ValidateIf((o: VerifyLoginDto) => o.email === undefined)
  @Type(() => Number)
  @IsInt()
  userId?: number;

  @ValidateIf((o: VerifyLoginDto) => o.userId === undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP code must be exactly 6 digits' })
  code: string;
}

export class SendOtpDto {
  @ValidateIf((o: SendOtpDto) => o.email === undefined)
  @Type(() => Number)
  @IsInt()
  userId?: number;

  @ValidateIf((o: SendOtpDto) => o.userId === undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email?: string;
}

export class Verify2FADto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'TOTP code must be exactly 6 digits' })
  code: string;
}
