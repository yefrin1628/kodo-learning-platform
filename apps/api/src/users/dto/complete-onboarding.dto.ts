import { IsIn } from 'class-validator';

// Matches the frontend's ONB questionnaire exactly: `time` step only ever
// offers 5/10/15/30, and `learn` collapses to 'code'/'lang' (the 'both'
// answer is normalized client-side before this ever gets sent) — validated
// here too, same server-never-trusts-the-client rule as everything else.
export class CompleteOnboardingDto {
  @IsIn([5, 10, 15, 30])
  goalMin!: number;

  @IsIn(['code', 'lang'])
  product!: 'code' | 'lang';
}
