import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global() // Make AuditService available everywhere without re-importing
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
