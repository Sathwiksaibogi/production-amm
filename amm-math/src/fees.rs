use crate::error::AmmMathError;

const BPS_DENOMINATOR: u128 = 10000;

pub fn calculate_fees(amount_in: u64, fee_bps: u16) -> Result<(u64, u64), AmmMathError> {
    if amount_in == 0 {
        return Err(AmmMathError::ZeroAmount);
    }
    if fee_bps >= 10000 {
        return Err(AmmMathError::InvalidFee);
    }

    let amount_in_u128 = u128::from(amount_in);
    let fee_bps_u128 = u128::from(fee_bps);
    let numerator = amount_in_u128 * fee_bps_u128;
    let fee_amount_u128 = numerator / BPS_DENOMINATOR;

    let fee_amount = u64::try_from(fee_amount_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;

    let amount_after_fee = amount_in
        .checked_sub(fee_amount)
        .ok_or(AmmMathError::ArithmeticFailure)?;

    Ok((fee_amount, amount_after_fee))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AmmMathError;

    #[test]
    fn calculates_normal_fee() {
        let result = calculate_fees(1000, 30);

        assert_eq!(result, Ok((3, 997)));
    }

    #[test]
    fn allows_zero_fee() {
        let result = calculate_fees(1000, 0);

        assert_eq!(result, Ok((0, 1000)));
    }

    #[test]
    fn tiny_input_rounds_fee_down_to_zero() {
        let result = calculate_fees(1, 30);

        assert_eq!(result, Ok((0, 1)));
    }

    #[test]
    fn rejects_zero_amount() {
        let result = calculate_fees(0, 30);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn rejects_fee_equal_to_one_hundred_percent() {
        let result = calculate_fees(1000, 10_000);

        assert_eq!(result, Err(AmmMathError::InvalidFee));
    }

    #[test]
    fn accepts_highest_valid_fee() {
        let result = calculate_fees(10_000, 9_999);

        assert_eq!(result, Ok((9_999, 1)));
    }

    #[test]
    fn fee_and_remaining_amount_preserve_original_input() {
        let amount_in = 123_456;
        let (fee, amount_after_fee) = calculate_fees(amount_in, 30).unwrap();

        assert_eq!(fee + amount_after_fee, amount_in);
    }
}
