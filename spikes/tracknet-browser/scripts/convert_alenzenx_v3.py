#!/usr/bin/env python3
"""Export alenzenx/TrackNetV3's MIT 3-frame CBAM tracker to ONNX."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys


def load_model_class(source):
    spec = importlib.util.spec_from_file_location('alenzenx_tracknet_model', pathlib.Path(source) / 'model.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.TrackNetV2


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, help='local alenzenx/TrackNetV3 checkout')
    parser.add_argument('--checkpoint', required=True, help='model_best.pt from the source release')
    parser.add_argument('--output', required=True)
    parser.add_argument('--height', type=int, default=288)
    parser.add_argument('--width', type=int, default=512)
    parser.add_argument('--dynamic-spatial', action='store_true')
    args = parser.parse_args()
    if (args.height, args.width) != (288, 512) and not args.dynamic_spatial:
        raise SystemExit('The released checkpoint is trained for 512x288; pass --dynamic-spatial for an explicit shape experiment')

    import onnx
    import torch

    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    params = checkpoint.get('param_dict', {})
    if int(params.get('num_frame', 3)) != 3 or params.get('input_type', '2d') != '2d':
        raise SystemExit(f'checkpoint is not the 3-frame 2d variant: {params}')
    model = load_model_class(args.source)(in_dim=9, out_dim=3)
    state = checkpoint.get('model_state_dict', checkpoint.get('model', checkpoint))
    state = {key.removeprefix('module.'): value for key, value in state.items()}
    model.load_state_dict(state, strict=True)
    model.eval()
    dummy = torch.zeros(1, 9, args.height, args.width)
    dynamic_axes = {'frames': {0: 'batch', 2: 'height', 3: 'width'}, 'heatmaps': {0: 'batch', 2: 'height', 3: 'width'}} if args.dynamic_spatial else None
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(model, dummy, output, opset_version=17, do_constant_folding=True, input_names=['frames'], output_names=['heatmaps'], dynamic_axes=dynamic_axes)
    onnx.checker.check_model(str(output))
    metadata = {
        'source': 'https://github.com/alenzenx/TrackNetV3',
        'source_license': 'MIT (repository LICENSE)',
        'checkpoint': str(pathlib.Path(args.checkpoint).resolve()), 'checkpoint_sha256': sha256(args.checkpoint),
        'input': [1, 9, args.height, args.width], 'output': [1, 3, args.height, args.width],
        'num_frame': 3, 'input_type': '2d', 'cbam': True, 'opset': 17,
    }
    output.with_suffix('.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
