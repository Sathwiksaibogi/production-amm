use crate::error::AmmMathError;
use crate::fees::calculate_fees;
#[derive(Debug, PartialEq, Eq)]
pub struct SwapResult {
    pub fee_amount: u64,
    pub amount_in_after_fee: u64,
    pub amount_out: u64,
}

pub fn calculate_swap_output(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    fee_bps: u16,
) -> Result<SwapResult, AmmMathError> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(AmmMathError::ZeroReserve);
    }
    let (fee_amount, amount_in_after_fee) = calculate_fees(amount_in, fee_bps)?;

    let reserve_in_u128 = u128::from(reserve_in);
    let reserve_out_u128 = u128::from(reserve_out);
    let amount_in_after_fee_u128 = u128::from(amount_in_after_fee);

    let numerator = reserve_out_u128 * amount_in_after_fee_u128;
    let denominator = reserve_in_u128 + amount_in_after_fee_u128;

    let amount_out_u128 = numerator / denominator;

    let amount_out = u64::try_from(amount_out_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;

    if amount_out == 0 {
        return Err(AmmMathError::ZeroOutput);
    }

    Ok(SwapResult {
        fee_amount,
        amount_in_after_fee,
        amount_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AmmMathError;

    #[test]
    fn calculates_swap_output_with_fee() {
        let result = calculate_swap_output(
            1_000, // reserve_in
            2_000, // reserve_out
            100,   // amount_in
            100,   // 1% fee
        )
        .unwrap();

        assert_eq!(
            result,
            SwapResult {
                fee_amount: 1,
                amount_in_after_fee: 99,
                amount_out: 180,
            }
        );
    }

    #[test]
    fn calculates_swap_output_without_fee() {
        let result = calculate_swap_output(1_000, 2_000, 100, 0).unwrap();

        assert_eq!(
            result,
            SwapResult {
                fee_amount: 0,
                amount_in_after_fee: 100,
                amount_out: 181,
            }
        );
    }

    #[test]
    fn rejects_zero_input_reserve() {
        let result = calculate_swap_output(0, 2_000, 100, 30);

        assert_eq!(result, Err(AmmMathError::ZeroReserve));
    }

    #[test]
    fn rejects_zero_output_reserve() {
        let result = calculate_swap_output(1_000, 0, 100, 30);

        assert_eq!(result, Err(AmmMathError::ZeroReserve));
    }

    #[test]
    fn propagates_zero_amount_error() {
        let result = calculate_swap_output(1_000, 2_000, 0, 30);

        assert_eq!(result, Err(AmmMathError::ZeroAmount));
    }

    #[test]
    fn propagates_invalid_fee_error() {
        let result = calculate_swap_output(1_000, 2_000, 100, 10_000);

        assert_eq!(result, Err(AmmMathError::InvalidFee));
    }

    #[test]
    fn rejects_swap_when_integer_output_is_zero() {
        let result = calculate_swap_output(1_000_000, 1, 1, 0);

        assert_eq!(result, Err(AmmMathError::ZeroOutput));
    }

    #[test]
    fn amount_out_is_always_less_than_output_reserve_for_sample_cases() {
        let cases = [
            (100_u64, 200_u64, 10_u64, 0_u16),
            (1_000, 2_000, 100, 30),
            (10_000, 50_000, 1_000, 100),
            (1_000_000, 2_000_000, 50_000, 30),
            (u64::MAX, u64::MAX, 1_000_000, 30),
        ];

        for (reserve_in, reserve_out, amount_in, fee_bps) in cases {
            let result =
                calculate_swap_output(reserve_in, reserve_out, amount_in, fee_bps).unwrap();

            assert!(
                result.amount_out < reserve_out,
                "amount_out {} must be less than reserve_out {}",
                result.amount_out,
                reserve_out
            );
        }
    }

    #[test]
    fn larger_trade_has_worse_average_execution() {
        let small_trade = calculate_swap_output(1_000, 2_000, 10, 0).unwrap();

        let large_trade = calculate_swap_output(1_000, 2_000, 100, 0).unwrap();

        let small_trade_rate = (small_trade.amount_out as u128 * 1_000_000) / 10;

        let large_trade_rate = (large_trade.amount_out as u128 * 1_000_000) / 100;

        assert!(
            small_trade_rate > large_trade_rate,
            "larger trades should receive worse average execution"
        );
    }

    #[test]
    fn deeper_pool_gives_better_execution_for_same_trade() {
        let shallow = calculate_swap_output(1_000, 2_000, 100, 0).unwrap();

        let deep = calculate_swap_output(100_000, 200_000, 100, 0).unwrap();

        assert!(
            deep.amount_out > shallow.amount_out,
            "deeper liquidity should reduce price impact"
        );
    }

    #[test]
    fn fee_reduces_swap_output() {
        let without_fee = calculate_swap_output(1_000, 2_000, 100, 0).unwrap();

        let with_fee = calculate_swap_output(1_000, 2_000, 100, 100).unwrap();

        assert!(
            with_fee.amount_out < without_fee.amount_out,
            "charging a fee should reduce trader output"
        );
    }

    #[test]
    fn fee_information_matches_input_accounting() {
        let amount_in = 123_456;

        let result = calculate_swap_output(1_000_000, 2_000_000, amount_in, 30).unwrap();

        assert_eq!(result.fee_amount + result.amount_in_after_fee, amount_in);
    }

    #[test]
    fn handles_large_values_without_u64_intermediate_overflow() {
        let result = calculate_swap_output(u64::MAX, u64::MAX, u64::MAX, 0).unwrap();

        assert!(result.amount_out > 0);
        assert!(result.amount_out < u64::MAX);

        assert_eq!(result.fee_amount, 0);
        assert_eq!(result.amount_in_after_fee, u64::MAX);
    }
}
