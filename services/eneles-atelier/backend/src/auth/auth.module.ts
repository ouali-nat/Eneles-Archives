import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../users/users.module';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (
        configService: ConfigService,
      ): Promise<JwtModuleOptions> => {
        const expiresIn = configService.get<string>(
          'JWT_EXPIRATION',
          '604800s',
        );
        const secret = configService.get<string>('JWT_SECRET');
        const nodeEnv = configService.get<string>('NODE_ENV', 'development');

        if (!secret) {
          if (nodeEnv === 'production') {
            throw new Error(
              'FATAL: JWT_SECRET environment variable is not set. ' +
                'Refusing to start in production without a secure secret.',
            );
          }
          console.warn(
            '⚠️  WARNING: JWT_SECRET not set, using insecure dev-only fallback. ' +
              'NEVER deploy to production without setting JWT_SECRET.',
          );
        }

        // In dev, use a random fallback so tokens are at least unique per restart
        const effectiveSecret =
          secret || require('crypto').randomBytes(32).toString('hex');

        return {
          secret: effectiveSecret,
          signOptions: {
            expiresIn: expiresIn as any,
            algorithm: 'HS256',
          },
          // Pin verification to the algorithm we sign with. With a symmetric
          // secret the classic alg-confusion attacks are not exploitable, but
          // an explicit allowlist costs nothing and removes the question.
          verifyOptions: {
            algorithms: ['HS256'],
          },
        };
      },
      inject: [ConfigService],
    }),
    forwardRef(() => UsersModule),
  ],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
