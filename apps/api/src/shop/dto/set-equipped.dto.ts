import { IsBoolean } from 'class-validator';

export class SetEquippedDto {
  @IsBoolean()
  equipped!: boolean;
}
