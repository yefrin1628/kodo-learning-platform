import { IsIn } from 'class-validator';

export class SubscribeDto {
  @IsIn(['PRO_MONTHLY', 'PRO_YEARLY'])
  planKey!: 'PRO_MONTHLY' | 'PRO_YEARLY';
}
