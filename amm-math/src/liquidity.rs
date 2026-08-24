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

pub fn calculate_liquidity_added(
    reserve_a: u64,
    reserve_b: u64,
    amount_a: u64,
    amount_b: u64,
    lp_supply: u64,
) -> Result<u64, AmmMathError> {
    if amount_a == 0 || amount_b == 0 {
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
    let amount_a_u128 = u128::from(amount_a);
    let amount_b_u128 = u128::from(amount_b);
    let lp_supply_u128 = u128::from(lp_supply);

    let left = amount_a_u128 * reserve_b_u128;
    let right = amount_b_u128 * reserve_a_u128;

    if left != right {
        return Err(AmmMathError::InvalidLiquidityRatio);
    }

    let numerator = amount_a_u128 * lp_supply_u128;
    let lp_a_minted_u128 = numerator / reserve_a_u128;

    let lp_a_minted =
        u64::try_from(lp_a_minted_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;

    if lp_a_minted == 0 {
        return Err(AmmMathError::ZeroLiquidityMinted);
    }

    Ok(lp_a_minted)
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
    #[test]
    fn calculates_proportional_liquidity_added() {
        let result = calculate_liquidity_added(
            1_000, // reserve_a
            2_000, // reserve_b
            100,   // amount_a
            200,   // amount_b
            1_000, // lp_supply
        )
        .unwrap();

        assert_eq!(result, 100);
    }

    #[test]
    fn depositing_amounts_equal_to_reserves_mints_current_lp_supply() {
        let result = calculate_liquidity_added(1_000, 2_000, 1_000, 2_000, 500).unwrap();

        assert_eq!(result, 500);
    }

    #[test]
    fn rejects_invalid_liquidity_ratio() {
        let result = calculate_liquidity_added(1_000, 2_000, 100, 150, 1_000);

        assert_eq!(result, Err(AmmMathError::InvalidLiquidityRatio));
    }

    #[test]
    fn rejects_zero_amount_a_for_existing_liquidity() {
        let result = calculate_liquidity_added(1_000, 2_000, 0, 200, 1_000);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn rejects_zero_amount_b_for_existing_liquidity() {
        let result = calculate_liquidity_added(1_000, 2_000, 100, 0, 1_000);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn rejects_zero_reserve_a() {
        let result = calculate_liquidity_added(0, 2_000, 100, 200, 1_000);

        assert_eq!(result, Err(AmmMathError::ZeroReserve));
    }

    #[test]
    fn rejects_zero_reserve_b() {
        let result = calculate_liquidity_added(1_000, 0, 100, 200, 1_000);

        assert_eq!(result, Err(AmmMathError::ZeroReserve));
    }

    #[test]
    fn rejects_zero_lp_supply_for_existing_pool() {
        let result = calculate_liquidity_added(1_000, 2_000, 100, 200, 0);

        assert_eq!(result, Err(AmmMathError::ZeroLiquiditySupply));
    }

    #[test]
    fn rejects_deposit_that_would_mint_zero_lp() {
        let result = calculate_liquidity_added(1_000, 2_000, 1, 2, 100);

        assert_eq!(result, Err(AmmMathError::ZeroLiquidityMinted));
    }

    #[test]
    fn doubling_proportional_deposit_doubles_lp_minted() {
        let smaller = calculate_liquidity_added(1_000, 2_000, 100, 200, 1_000).unwrap();

        let larger = calculate_liquidity_added(1_000, 2_000, 200, 400, 1_000).unwrap();

        assert_eq!(larger, smaller * 2);
    }

    #[test]
    fn liquidity_added_is_symmetric_between_tokens() {
        let normal = calculate_liquidity_added(1_000, 2_000, 100, 200, 1_000).unwrap();

        let reversed = calculate_liquidity_added(2_000, 1_000, 200, 100, 1_000).unwrap();

        assert_eq!(normal, reversed);
    }

    #[test]
    fn handles_maximum_u64_values_for_proportional_liquidity() {
        let result =
            calculate_liquidity_added(u64::MAX, u64::MAX, u64::MAX, u64::MAX, u64::MAX).unwrap();

        assert_eq!(result, u64::MAX);
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
