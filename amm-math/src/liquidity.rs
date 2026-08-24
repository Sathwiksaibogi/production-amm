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
