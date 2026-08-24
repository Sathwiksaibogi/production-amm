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
}
