use crate::error::AmmMathError;
use crate::integer_sqrt::integer_sqrt;

pub fn calculate_initial_liquidity(amount_a: u64, amount_b: u64) -> Result<u64, AmmMathError> {
    if amount_a == 0 || amount_b == 0 {
        return Err(AmmMathError::ZeroAmount);
    }

    let amount_a_u128 = u128::from(amount_a);
    let amount_b_u128 = u128::from(amount_b);
    let product = amount_a_u128 * amount_b_u128;
    let initial_lp_u128 = integer_sqrt(product);
    let initial_lp = u64::try_from(initial_lp_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;
    Ok(initial_lp)
}

#[derive(Debug, PartialEq, Eq)]
pub struct AddLiquidityResult {
    pub lp_minted: u64,
    pub amount_a_used: u64,
    pub amount_b_used: u64,
}
pub fn calculate_liquidity_added(
    reserve_a: u64,
    reserve_b: u64,
    amount_a_desired: u64,
    amount_b_desired: u64,
    lp_supply: u64,
) -> Result<AddLiquidityResult, AmmMathError> {
    if amount_a_desired == 0 || amount_b_desired == 0 {
        return Err(AmmMathError::ZeroAmount);
    }
    if reserve_a == 0 || reserve_b == 0 {
        return Err(AmmMathError::ZeroReserve);
    }
    if lp_supply == 0 {
        return Err(AmmMathError::ZeroLiquiditySupply);
    }
    let reserve_a_u128 = u128::from(reserve_a);
    let reserve_b_u128 = u128::from(reserve_b);
    let amount_a_u128 = u128::from(amount_a_desired);
    let amount_b_u128 = u128::from(amount_b_desired);
    let lp_supply_u128 = u128::from(lp_supply);

    let numerator_a = amount_a_u128 * lp_supply_u128;
    let lp_a_minted_u128 = numerator_a / reserve_a_u128;

    let numerator_b = amount_b_u128 * lp_supply_u128;
    let lp_b_minted_u128 = numerator_b / reserve_b_u128;

    let lp_minted_u128 = std::cmp::min(lp_a_minted_u128, lp_b_minted_u128);

    let lp_minted = u64::try_from(lp_minted_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;

    if lp_minted == 0 {
        return Err(AmmMathError::ZeroLiquidityMinted);
    }

    let lp_minted_u128 = u128::from(lp_minted);
    let amount_a_used_u128 = ceil_div(lp_minted_u128 * reserve_a_u128, lp_supply_u128)?;
    let amount_b_used_u128 = ceil_div(lp_minted_u128 * reserve_b_u128, lp_supply_u128)?;
    let amount_a_used =
        u64::try_from(amount_a_used_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;
    let amount_b_used =
        u64::try_from(amount_b_used_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;

    if amount_a_used > amount_a_desired || amount_b_used > amount_b_desired {
        return Err(AmmMathError::ArithmeticFailure);
    }

    Ok(AddLiquidityResult {
        lp_minted: lp_minted,
        amount_a_used: amount_a_used,
        amount_b_used: amount_b_used,
    })
}
fn ceil_div(numerator: u128, denominator: u128) -> Result<u128, AmmMathError> {
    let quotient = numerator / denominator;

    let remainder = numerator % denominator;

    if remainder == 0 {
        Ok(quotient)
    } else {
        quotient
            .checked_add(1)
            .ok_or(AmmMathError::ArithmeticFailure)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct LiquidityWithdrawal {
    pub amount_a: u64,
    pub amount_b: u64,
}
pub fn calculate_liquidity_withdrawal(
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
    lp_to_burn: u64,
) -> Result<LiquidityWithdrawal, AmmMathError> {
    if lp_to_burn == 0 {
        return Err(AmmMathError::ZeroAmount);
    }
    if reserve_a == 0 || reserve_b == 0 {
        return Err(AmmMathError::ZeroReserve);
    }
    if lp_supply == 0 {
        return Err(AmmMathError::ZeroLiquiditySupply);
    }
    if lp_to_burn > lp_supply {
        return Err(AmmMathError::LiquidityBurnExceedsSupply);
    }
    let reserve_a_u128 = u128::from(reserve_a);
    let reserve_b_u128 = u128::from(reserve_b);
    let lp_supply_u128 = u128::from(lp_supply);
    let lp_to_burn_u128 = u128::from(lp_to_burn);

    let numerator_a = reserve_a_u128 * lp_to_burn_u128;
    let numerator_b = reserve_b_u128 * lp_to_burn_u128;

    let amount_a_u128 = numerator_a / lp_supply_u128;
    let amount_b_u128 = numerator_b / lp_supply_u128;

    let amount_a = u64::try_from(amount_a_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;
    let amount_b = u64::try_from(amount_b_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;

    if amount_a == 0 || amount_b == 0 {
        return Err(AmmMathError::ZeroWithdrawalAmount);
    }

    Ok(LiquidityWithdrawal { amount_a, amount_b })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AmmMathError;

    #[test]
    fn calculates_exact_initial_liquidity() {
        let result = calculate_initial_liquidity(100, 225).unwrap();

        assert_eq!(result, 150);
    }

    #[test]
    fn floors_non_exact_initial_liquidity() {
        let result = calculate_initial_liquidity(100, 200).unwrap();

        assert_eq!(result, 141);
    }

    #[test]
    fn rejects_zero_amount_a() {
        let result = calculate_initial_liquidity(0, 200);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn rejects_zero_amount_b() {
        let result = calculate_initial_liquidity(100, 0);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn rejects_both_amounts_zero() {
        let result = calculate_initial_liquidity(0, 0);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn minimum_positive_deposit_mints_one_lp_unit() {
        let result = calculate_initial_liquidity(1, 1).unwrap();

        assert_eq!(result, 1);
    }

    #[test]
    fn doubling_both_sides_doubles_liquidity_for_matching_scale() {
        let smaller = calculate_initial_liquidity(100, 400).unwrap();
        let larger = calculate_initial_liquidity(200, 800).unwrap();

        assert_eq!(larger, smaller * 2);
    }

    #[test]
    fn liquidity_calculation_is_symmetric() {
        let ab = calculate_initial_liquidity(100, 400).unwrap();
        let ba = calculate_initial_liquidity(400, 100).unwrap();

        assert_eq!(ab, ba);
    }

    #[test]
    fn handles_maximum_u64_amounts() {
        let result = calculate_initial_liquidity(u64::MAX, u64::MAX).unwrap();

        assert_eq!(result, u64::MAX);
    }

    #[test]
    fn minted_liquidity_does_not_exceed_geometric_mean() {
        let cases = [
            (1_u64, 2_u64),
            (100, 200),
            (100, 225),
            (1_000, 2_000),
            (123_456, 789_012),
            (u64::MAX, u64::MAX),
        ];

        for (amount_a, amount_b) in cases {
            let lp = calculate_initial_liquidity(amount_a, amount_b).unwrap();

            let product = u128::from(amount_a) * u128::from(amount_b);

            let lp_u128 = u128::from(lp);

            assert!(
                lp_u128 <= product / lp_u128,
                "LP amount must satisfy lp^2 <= amount_a * amount_b"
            );
        }
    }
    #[cfg(test)]
    mod optimal_liquidity_tests {
        use super::*;

        #[test]
        fn adds_exactly_proportional_liquidity() {
            let result =
                calculate_liquidity_added(1_000_000, 4_000_000, 500_000, 2_000_000, 2_000_000)
                    .unwrap();

            assert_eq!(
                result,
                AddLiquidityResult {
                    lp_minted: 1_000_000,
                    amount_a_used: 500_000,
                    amount_b_used: 2_000_000,
                }
            );
        }

        #[test]
        fn token_a_can_be_the_limiting_asset() {
            let result =
                calculate_liquidity_added(1_500_000, 6_000_000, 100_000, 500_000, 3_000_000)
                    .unwrap();

            assert_eq!(
                result,
                AddLiquidityResult {
                    lp_minted: 200_000,
                    amount_a_used: 100_000,
                    amount_b_used: 400_000,
                }
            );
        }

        #[test]
        fn token_b_can_be_the_limiting_asset() {
            let result =
                calculate_liquidity_added(1_500_000, 6_000_000, 150_000, 400_000, 3_000_000)
                    .unwrap();

            assert_eq!(
                result,
                AddLiquidityResult {
                    lp_minted: 200_000,
                    amount_a_used: 100_000,
                    amount_b_used: 400_000,
                }
            );
        }

        #[test]
        fn handles_live_post_swap_reserves_without_exact_ratio_requirement() {
            let result =
                calculate_liquidity_added(1_055_000, 3_422_833, 10_000, 33_000, 1_900_000).unwrap();

            assert_eq!(
                result,
                AddLiquidityResult {
                    lp_minted: 18_009,
                    amount_a_used: 10_000,
                    amount_b_used: 32_444,
                }
            );
        }

        #[test]
        fn rounds_actual_token_amounts_up() {
            let result = calculate_liquidity_added(3, 7, 1, 3, 10).unwrap();

            assert_eq!(
                result,
                AddLiquidityResult {
                    lp_minted: 3,
                    amount_a_used: 1,
                    amount_b_used: 3,
                }
            );
        }

        #[test]
        fn never_uses_more_than_the_desired_amounts_for_sample_cases() {
            let cases = [
                (1_000_u64, 4_000_u64, 100_u64, 500_u64, 2_000_u64),
                (1_055, 3_423, 10, 40, 1_900),
                (3, 7, 1, 3, 10),
                (17, 29, 100, 200, 1_000),
                (999_983, 2_000_033, 50_000, 120_000, 900_000),
            ];

            for (reserve_a, reserve_b, desired_a, desired_b, supply) in cases {
                let result =
                    calculate_liquidity_added(reserve_a, reserve_b, desired_a, desired_b, supply)
                        .unwrap();

                assert!(result.amount_a_used <= desired_a);
                assert!(result.amount_b_used <= desired_b);
                assert!(result.lp_minted > 0);
            }
        }

        #[test]
        fn chooses_limiting_candidate_before_u64_conversion() {
            let result = calculate_liquidity_added(1, u64::MAX, u64::MAX, 1, u64::MAX).unwrap();

            /*
             * The A-side LP candidate is larger than u64::MAX,
             * but B supports only one LP unit. The function must
             * choose the u128 minimum before converting to u64.
             */
            assert_eq!(
                result,
                AddLiquidityResult {
                    lp_minted: 1,
                    amount_a_used: 1,
                    amount_b_used: 1,
                }
            );
        }

        #[test]
        fn handles_maximum_equal_values() {
            let result =
                calculate_liquidity_added(u64::MAX, u64::MAX, u64::MAX, u64::MAX, u64::MAX)
                    .unwrap();

            assert_eq!(
                result,
                AddLiquidityResult {
                    lp_minted: u64::MAX,
                    amount_a_used: u64::MAX,
                    amount_b_used: u64::MAX,
                }
            );
        }

        #[test]
        fn rejects_zero_desired_token_a() {
            assert_eq!(
                calculate_liquidity_added(1_000, 2_000, 0, 200, 1_000),
                Err(AmmMathError::ZeroAmount)
            );
        }

        #[test]
        fn rejects_zero_desired_token_b() {
            assert_eq!(
                calculate_liquidity_added(1_000, 2_000, 100, 0, 1_000),
                Err(AmmMathError::ZeroAmount)
            );
        }

        #[test]
        fn rejects_zero_reserve_a() {
            assert_eq!(
                calculate_liquidity_added(0, 2_000, 100, 200, 1_000),
                Err(AmmMathError::ZeroReserve)
            );
        }

        #[test]
        fn rejects_zero_reserve_b() {
            assert_eq!(
                calculate_liquidity_added(1_000, 0, 100, 200, 1_000),
                Err(AmmMathError::ZeroReserve)
            );
        }

        #[test]
        fn rejects_zero_lp_supply() {
            assert_eq!(
                calculate_liquidity_added(1_000, 2_000, 100, 200, 0),
                Err(AmmMathError::ZeroLiquiditySupply)
            );
        }

        #[test]
        fn rejects_when_limiting_side_mints_zero_lp() {
            assert_eq!(
                calculate_liquidity_added(1_000_000, 2_000_000, 1, 2, 1,),
                Err(AmmMathError::ZeroLiquidityMinted)
            );
        }
    }

    #[test]
    fn calculates_proportional_liquidity_withdrawal() {
        let result = calculate_liquidity_withdrawal(1_000, 2_000, 1_000, 100).unwrap();

        assert_eq!(
            result,
            LiquidityWithdrawal {
                amount_a: 100,
                amount_b: 200,
            }
        );
    }

    #[test]
    fn withdrawing_half_lp_supply_returns_half_reserves() {
        let result = calculate_liquidity_withdrawal(1_000, 2_000, 1_000, 500).unwrap();

        assert_eq!(
            result,
            LiquidityWithdrawal {
                amount_a: 500,
                amount_b: 1_000,
            }
        );
    }

    #[test]
    fn withdrawing_full_lp_supply_returns_full_reserves() {
        let result = calculate_liquidity_withdrawal(1_000, 2_000, 1_000, 1_000).unwrap();

        assert_eq!(
            result,
            LiquidityWithdrawal {
                amount_a: 1_000,
                amount_b: 2_000,
            }
        );
    }

    #[test]
    fn rejects_zero_lp_burn() {
        let result = calculate_liquidity_withdrawal(1_000, 2_000, 1_000, 0);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn rejects_zero_reserve_a_for_withdrawal() {
        let result = calculate_liquidity_withdrawal(0, 2_000, 1_000, 100);

        assert_eq!(result, Err(AmmMathError::ZeroReserve));
    }

    #[test]
    fn rejects_zero_reserve_b_for_withdrawal() {
        let result = calculate_liquidity_withdrawal(1_000, 0, 1_000, 100);

        assert_eq!(result, Err(AmmMathError::ZeroReserve));
    }

    #[test]
    fn rejects_zero_lp_supply_for_withdrawal() {
        let result = calculate_liquidity_withdrawal(1_000, 2_000, 0, 100);

        assert_eq!(result, Err(AmmMathError::ZeroLiquiditySupply));
    }

    #[test]
    fn rejects_lp_burn_greater_than_total_supply() {
        let result = calculate_liquidity_withdrawal(1_000, 2_000, 1_000, 1_001);

        assert_eq!(result, Err(AmmMathError::LiquidityBurnExceedsSupply));
    }

    #[test]
    fn rejects_withdrawal_that_rounds_to_zero() {
        let result = calculate_liquidity_withdrawal(100, 100, 1_000_000, 1);

        assert_eq!(result, Err(AmmMathError::ZeroWithdrawalAmount));
    }

    #[test]
    fn handles_maximum_u64_withdrawal_values() {
        let result =
            calculate_liquidity_withdrawal(u64::MAX, u64::MAX, u64::MAX, u64::MAX).unwrap();

        assert_eq!(
            result,
            LiquidityWithdrawal {
                amount_a: u64::MAX,
                amount_b: u64::MAX,
            }
        );
    }

    #[test]
    fn withdrawal_is_symmetric_between_tokens() {
        let normal = calculate_liquidity_withdrawal(1_000, 2_000, 1_000, 100).unwrap();

        let reversed = calculate_liquidity_withdrawal(2_000, 1_000, 1_000, 100).unwrap();

        assert_eq!(normal.amount_a, reversed.amount_b);
        assert_eq!(normal.amount_b, reversed.amount_a);
    }

    #[test]
    fn withdrawal_never_exceeds_pool_reserves_for_sample_cases() {
        let cases = [
            (1_000_u64, 2_000_u64, 1_000_u64, 100_u64),
            (10_000, 50_000, 5_000, 1_000),
            (1_000_000, 2_000_000, 100_000, 50_000),
            (u64::MAX, u64::MAX, u64::MAX, u64::MAX),
        ];

        for (reserve_a, reserve_b, lp_supply, lp_to_burn) in cases {
            let result =
                calculate_liquidity_withdrawal(reserve_a, reserve_b, lp_supply, lp_to_burn)
                    .unwrap();

            assert!(result.amount_a <= reserve_a);
            assert!(result.amount_b <= reserve_b);
        }
    }
}
