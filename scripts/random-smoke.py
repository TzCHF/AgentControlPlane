import random
import sys


def main() -> int:
    low, high = 1, 100
    value = random.randint(low, high)
    assert low <= value <= high, f"value {value} out of range [{low}, {high}]"
    print(f"generated={value} range=[{low},{high}] ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
